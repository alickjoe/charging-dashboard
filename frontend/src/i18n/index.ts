import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

// Read initial language from zustand persist localStorage
function getInitialLanguage(): 'en' | 'zh' {
  try {
    const raw = localStorage.getItem('app-locale');
    if (raw) {
      const parsed = JSON.parse(raw);
      const lang = parsed?.state?.language;
      if (lang === 'en' || lang === 'zh') return lang;
    }
  } catch {
    // ignore parse errors
  }
  return 'en';
}

i18next
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false,
      prefix: '{',
      suffix: '}',
    },
  });

export default i18next;
