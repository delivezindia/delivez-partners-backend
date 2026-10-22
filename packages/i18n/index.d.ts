export type LanguageCode = 'EN' | 'HI' | 'KN' | 'TA' | 'TE' | 'ML' | 'MR' | 'BN';
export interface LanguageInfo {
  code: LanguageCode;
  locale: string;
  label: string;
  english: string;
}
export interface LoadedLanguage extends LanguageInfo {
  version: string;
  /** % of English keys translated in this language. */
  coverage: number;
  messages: Record<string, string>;
}
export declare const LANGUAGES: LanguageInfo[];
export declare function load(code: string): LoadedLanguage | null;
