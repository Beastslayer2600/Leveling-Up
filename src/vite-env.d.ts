/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional coach endpoint: POST { prompt } -> JSON array of suggestions. Leave unset to hide the coach. */
  readonly VITE_COACH_URL: string;
}
