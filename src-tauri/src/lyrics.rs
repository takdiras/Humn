use futures_util::StreamExt;
use tauri::ipc::Channel;

// ─── YouTube Music video-ID lookup ──────────────────────────────────────────

/// Search YouTube Music's internal API for a video ID matching title + artist.
/// Uses the innertube WEB_REMIX client — no authentication required for basic search.
async fn ytm_search_video_id(client: &reqwest::Client, title: &str, artist: &str) -> Option<String> {
    let query = format!("{} {}", title, artist);

    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query,
        "params": "EgWKAQIIAWoKEAkQBRAKEAMQBBAU"
    });

    let resp = client
        .post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/search")
        .header("X-YouTube-Client-Name", "67")
        .header("X-YouTube-Client-Version", "1.20240101.01.00")
        .json(&body)
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let text = resp.text().await.ok()?;
    first_video_id(&text)
}

/// Extract the first valid (11-char) YouTube video ID from a YTM JSON blob.
fn first_video_id(text: &str) -> Option<String> {
    let needle = "\"videoId\":\"";
    let start = text.find(needle)? + needle.len();
    let id: String = text[start..].chars().take(11).collect();
    if id.len() == 11 && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        Some(id)
    } else {
        None
    }
}

/// Payload sent per SSE message to the frontend channel.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LyricsEvent {
    /// A provider SSE message — event name + raw JSON data string.
    Provider { event: String, data: String },
    /// Stream finished (all providers responded or connection closed).
    Done,
    /// Fatal error before any data arrived.
    Error { message: String },
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())
}

/// Exchange a Cloudflare Turnstile token for a JWT from the better-lyrics API.
/// Must go through Rust to bypass CORS restrictions on the verify endpoint.
#[tauri::command]
pub async fn verify_turnstile(turnstile_token: String) -> Result<String, String> {
    let client = build_client()?;
    let resp = client
        .post("https://lyrics.api.dacubeking.com/verify-turnstile")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "token": turnstile_token }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("verify_http_{}", resp.status().as_u16()));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let jwt = data["jwt"].as_str().unwrap_or("").to_string();
    if jwt.is_empty() {
        return Err("no_jwt_in_response".to_string());
    }
    Ok(jwt)
}

/// Stream lyrics from the better-lyrics API over a Tauri Channel.
/// The HTTP request is made from Rust to bypass browser CORS restrictions.
/// If `video_id` is empty the function will search YouTube Music to find one.
#[tauri::command]
pub async fn stream_lyrics(
    on_event: Channel<LyricsEvent>,
    title: String,
    artist: String,
    duration_secs: u32,
    token: String,
    video_id: String,
) -> Result<(), String> {
    let client = build_client()?;

    // Resolve video ID — required by the better-lyrics API.
    let resolved_video_id = if video_id.is_empty() {
        ytm_search_video_id(&client, &title, &artist).await.unwrap_or_default()
    } else {
        video_id.clone()
    };

    let mut params = vec![
        ("song", title),
        ("artist", artist),
        ("duration", duration_secs.to_string()),
        ("token", token),
    ];
    if !resolved_video_id.is_empty() {
        params.push(("videoId", resolved_video_id));
    }

    let resp = client
        .post("https://lyrics.api.dacubeking.com/v2/lyrics")
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            let _ = on_event.send(LyricsEvent::Error { message: e.to_string() });
            e.to_string()
        })?;

    if !resp.status().is_success() {
        let msg = format!("http_{}", resp.status().as_u16());
        let _ = on_event.send(LyricsEvent::Error { message: msg.clone() });
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let _ = on_event.send(LyricsEvent::Error { message: e.to_string() });
                break;
            }
        };

        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // Process all complete SSE messages (separated by double newlines)
        loop {
            let sep = if let Some(p) = buffer.find("\r\n\r\n") {
                Some((p, 4))
            } else if let Some(p) = buffer.find("\n\n") {
                Some((p, 2))
            } else {
                break;
            };

            let (msg_end, sep_len) = sep.unwrap();
            let message = buffer[..msg_end].to_string();
            buffer = buffer[msg_end + sep_len..].to_string();

            if message.trim().is_empty() {
                continue;
            }

            let mut event = String::new();
            let mut data = String::new();

            for line in message.lines() {
                if let Some(val) = line.strip_prefix("event:") {
                    event = val.trim().to_string();
                } else if let Some(val) = line.strip_prefix("data:") {
                    data.push_str(val.trim());
                }
            }

            if data == "[DONE]" {
                let _ = on_event.send(LyricsEvent::Done);
                return Ok(());
            }

            if !event.is_empty() && !data.is_empty() {
                let _ = on_event.send(LyricsEvent::Provider { event, data });
            }
        }
    }

    let _ = on_event.send(LyricsEvent::Done);
    Ok(())
}
