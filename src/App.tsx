import { useTranslation } from 'react-i18next';
import { AppShell } from './components/layout/AppShell';
import { Container } from './components/layout/Container';
import { Section } from './components/layout/Section';
import './App.css';

function App() {
  const { t } = useTranslation();

  return (
    <AppShell>
      <Section>
        <Container>
          <div className="max-w-3xl mb-8">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-4">
              {t('brand.name')}
            </h1>
            <p className="text-xl text-emerald-700 dark:text-emerald-400 font-medium">
              {t('brand.subtitle')}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 max-w-2xl">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
              {t('home.welcome')}
            </h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              {t('home.description')}
            </p>
          </div>
        </Container>
      </Section>
    </AppShell>
  );
}

export default App;


