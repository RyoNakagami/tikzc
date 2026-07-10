export const ENGLISH_LANGUAGE_CODE = 'en';

export interface EnglishLanguageConfig {
  code: 'en';
  pretolerance: number;
  tolerance: number;
  linepenalty: number;
  hyphenpenalty: number;
  exhyphenpenalty: number;
  adjdemerits: number;
  doublehyphendemerits: number;
  finalhyphendemerits: number;
  lefthyphenmin: number;
  righthyphenmin: number;
}

export const englishDefaults: EnglishLanguageConfig = {
  code: 'en',
  pretolerance: 100,
  tolerance: 200,
  linepenalty: 10,
  hyphenpenalty: 50,
  exhyphenpenalty: 50,
  adjdemerits: 10000,
  doublehyphendemerits: 10000,
  finalhyphendemerits: 5000,
  lefthyphenmin: 2,
  righthyphenmin: 3,
};
