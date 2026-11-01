// Loaded into /usr/bin/perl by macos.rs. Since macOS 15.4, MediaRemote only
// returns now-playing info to Apple-signed processes, so the app can't call it
// directly. Writes one JSON line per poll to stdout: a NowPlayingInfo or null.

#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <unistd.h>

typedef void (*GetNowPlayingInfoFn)(dispatch_queue_t, void (^)(NSDictionary *));

static NSString *string_value(NSDictionary *info, NSString *key) {
    id v = info[key];
    return [v isKindOfClass:[NSString class]] ? v : @"";
}

static double number_value(NSDictionary *info, NSString *key) {
    id v = info[key];
    return [v isKindOfClass:[NSNumber class]] ? [v doubleValue] : 0;
}

static NSData *snapshot(GetNowPlayingInfoFn getInfo) {
    NSData *null_line = [@"null" dataUsingEncoding:NSUTF8StringEncoding];

    __block NSDictionary *info = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    getInfo(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^(NSDictionary *d) {
        info = d;
        dispatch_semaphore_signal(sem);
    });
    if (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC)) != 0) {
        return null_line;
    }

    NSString *title = string_value(info, @"kMRMediaRemoteNowPlayingInfoTitle");
    NSString *artist = string_value(info, @"kMRMediaRemoteNowPlayingInfoArtist");
    if (title.length == 0 && artist.length == 0) {
        return null_line;
    }

    double rate = number_value(info, @"kMRMediaRemoteNowPlayingInfoPlaybackRate");
    double elapsed = number_value(info, @"kMRMediaRemoteNowPlayingInfoElapsedTime");

    // ElapsedTime is only refreshed when the player reports it; advance it to now.
    id timestamp = info[@"kMRMediaRemoteNowPlayingInfoTimestamp"];
    if (rate > 0 && [timestamp isKindOfClass:[NSDate class]]) {
        elapsed += -[timestamp timeIntervalSinceNow] * rate;
    }

    NSDictionary *out = @{
        @"title": title,
        @"artist": artist,
        @"position_ms": @((long long)(elapsed * 1000)),
        @"duration_ms": @((long long)(number_value(info, @"kMRMediaRemoteNowPlayingInfoDuration") * 1000)),
        @"is_playing": rate > 0 ? @YES : @NO,
    };
    return [NSJSONSerialization dataWithJSONObject:out options:0 error:nil] ?: null_line;
}

// Called from perl; never returns. Exits via SIGPIPE once the app closes the pipe.
void humn_stream(void) {
    void *mr = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW);
    GetNowPlayingInfoFn getInfo = mr ? (GetNowPlayingInfoFn)dlsym(mr, "MRMediaRemoteGetNowPlayingInfo") : NULL;
    if (!getInfo) {
        exit(1);
    }

    for (;;) {
        @autoreleasepool {
            NSMutableData *line = [snapshot(getInfo) mutableCopy];
            [line appendBytes:"\n" length:1];
            if (write(STDOUT_FILENO, line.bytes, line.length) < 0) {
                exit(0);
            }
        }
        usleep(100 * 1000);
    }
}
