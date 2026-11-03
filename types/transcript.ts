export interface TranscriptWord {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

export interface Transcript {
  text: string;
  words: TranscriptWord[];
  durationSeconds: number;
}
