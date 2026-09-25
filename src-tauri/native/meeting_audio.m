// Audio-only ScreenCaptureKit bridge. No screen output is registered or saved.
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreAudio/CoreAudioTypes.h>

typedef void (*AudioCallback)(void *, const float *, size_t, double);
typedef void (*ErrorCallback)(void *, const char *);

API_AVAILABLE(macos(13.0))
@interface PlatypusAudioCapture : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic) AudioCallback callback;
@property(nonatomic) ErrorCallback errorCallback;
@property(nonatomic) void *context;
@end

@implementation PlatypusAudioCapture
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    @synchronized(self) {
    if (!self.context) return;
    if (type != SCStreamOutputTypeAudio || !CMSampleBufferDataIsReady(sample)) return;
    const AudioStreamBasicDescription *format = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample));
    if (!format || format->mFormatID != kAudioFormatLinearPCM || !(format->mFormatFlags & kAudioFormatFlagIsFloat) || format->mBitsPerChannel != 32 || format->mSampleRate != 48000) {
        self.errorCallback(self.context, "Meeting audio changed to an unsupported format. Stop and restart recording.");
        return;
    }
    size_t size = 0;
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, &size, NULL, 0, NULL, NULL, 0, NULL);
    AudioBufferList *list = malloc(size);
    CMBlockBufferRef block = NULL;
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, NULL, list, size, NULL, NULL, kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &block);
    if (status == noErr) {
        size_t frames = CMSampleBufferGetNumSamples(sample);
        float *mono = calloc(frames, sizeof(float));
        unsigned channels = 0;
        for (unsigned b = 0; b < list->mNumberBuffers; b++) {
            AudioBuffer buffer = list->mBuffers[b];
            const float *data = buffer.mData;
            if (!data || buffer.mDataByteSize < frames * buffer.mNumberChannels * sizeof(float)) continue;
            channels += buffer.mNumberChannels;
            for (size_t f = 0; f < frames; f++)
                for (unsigned c = 0; c < buffer.mNumberChannels; c++)
                    mono[f] += data[f * buffer.mNumberChannels + c];
        }
        if (channels) {
            for (size_t f = 0; f < frames; f++) mono[f] /= channels;
            double age = CMTimeGetSeconds(CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), CMSampleBufferGetPresentationTimeStamp(sample)));
            self.callback(self.context, mono, frames, age);
        }
        free(mono);
    } else {
        self.errorCallback(self.context, "Could not read meeting audio.");
    }
    if (block) CFRelease(block);
    free(list);
    }
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    @synchronized(self) {
        if (self.context) self.errorCallback(self.context, error.localizedDescription.UTF8String);
    }
}
@end

// Called on the Rust capture thread, never the main/UI thread. The retained
// delegate and its Rust context live until stop drains the serial callback queue.
void *platypus_system_audio_start(AudioCallback callback, ErrorCallback errorCallback, void *context, char *error, size_t capacity) {
    @autoreleasepool {
        if (@available(macOS 13.0, *)) {
            dispatch_semaphore_t ready = dispatch_semaphore_create(0);
            __block SCShareableContent *content = nil;
            __block NSError *failure = nil;
            [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *value, NSError *err) {
                content = value; failure = err; dispatch_semaphore_signal(ready);
            }];
            if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC)) != 0) {
                snprintf(error, capacity, "Meeting audio permission is still pending. Allow Platypus in System Settings > Privacy & Security > Screen & System Audio Recording, then try again.");
                return NULL;
            }
            if (failure || !content.displays.count) {
                snprintf(error, capacity, "Meeting audio unavailable. Allow Platypus in System Settings > Privacy & Security > Screen & System Audio Recording, then restart Platypus. %s", failure.localizedDescription.UTF8String ?: "No display available.");
                return NULL;
            }
            PlatypusAudioCapture *capture = [PlatypusAudioCapture new];
            capture.callback = callback; capture.errorCallback = errorCallback; capture.context = context;
            capture.queue = dispatch_queue_create("com.platypus.meeting-audio", DISPATCH_QUEUE_SERIAL);
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:content.displays.firstObject excludingApplications:@[] exceptingWindows:@[]];
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            config.capturesAudio = YES;
            config.excludesCurrentProcessAudio = YES;
            config.sampleRate = 48000;
            config.channelCount = 2;
            config.width = 2; config.height = 2; config.minimumFrameInterval = CMTimeMake(1, 1);
            config.showsCursor = NO;
            capture.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:capture];
            NSError *outputError = nil;
            if (![capture.stream addStreamOutput:capture type:SCStreamOutputTypeAudio sampleHandlerQueue:capture.queue error:&outputError]) {
                snprintf(error, capacity, "%s", outputError.localizedDescription.UTF8String);
                return NULL;
            }
            // Completion must settle before releasing the Rust callback context.
            [capture.stream startCaptureWithCompletionHandler:^(NSError *err) { failure = err; dispatch_semaphore_signal(ready); }];
            dispatch_semaphore_wait(ready, DISPATCH_TIME_FOREVER);
            if (failure) {
                [capture.stream removeStreamOutput:capture type:SCStreamOutputTypeAudio error:nil];
                dispatch_sync(capture.queue, ^{});
            @synchronized(capture) { capture.context = NULL; }
                snprintf(error, capacity, "%s", failure.localizedDescription.UTF8String);
                return NULL;
            }
            return (__bridge_retained void *)capture;
        }
        snprintf(error, capacity, "Meeting audio requires macOS 13 or newer. Choose Microphone only on this Mac.");
        return NULL;
    }
}

void platypus_system_audio_stop(void *handle) {
    @autoreleasepool {
        if (@available(macOS 13.0, *)) {
            PlatypusAudioCapture *capture = (__bridge_transfer PlatypusAudioCapture *)handle;
            dispatch_semaphore_t stopped = dispatch_semaphore_create(0);
            [capture.stream stopCaptureWithCompletionHandler:^(NSError *err) { (void)err; dispatch_semaphore_signal(stopped); }];
            dispatch_semaphore_wait(stopped, DISPATCH_TIME_FOREVER);
            [capture.stream removeStreamOutput:capture type:SCStreamOutputTypeAudio error:nil];
            dispatch_sync(capture.queue, ^{});
            @synchronized(capture) { capture.context = NULL; }
        }
    }
}
