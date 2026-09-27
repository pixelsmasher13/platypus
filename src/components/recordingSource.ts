export type RecordingSource = 'both' | 'microphone' | 'system';
export type RecordingSourceSettings = { record_meeting_audio: boolean; record_microphone: boolean };
export const recordingSourceNames: Record<RecordingSource, string> = {
  both: 'Mic + meeting audio',
  microphone: 'Microphone only',
  system: 'Meeting audio only',
};
// Meeting audio exists only on macOS. Both switches off records the microphone rather than nothing.
export function preferredRecordingSource(settings: RecordingSourceSettings, mac: boolean): RecordingSource {
  if (!mac || !settings.record_meeting_audio) return 'microphone';
  return settings.record_microphone ? 'both' : 'system';
}
// Until macOS allows meeting audio, record the microphone and say so in the notice; never fail the recording.
export function effectiveRecordingSource(preferred: RecordingSource, meetingAudioAllowed: boolean | null): RecordingSource {
  return preferred !== 'microphone' && meetingAudioAllowed === false ? 'microphone' : preferred;
}
