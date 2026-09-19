import { useTranslation } from 'react-i18next';
import { Container } from './Container';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer 
      data-responsive-guard
      className="bg-gray-900 text-gray-300 py-12 border-t border-gray-800 w-full max-w-full min-w-0"
    >
      <Container className="w-full max-w-full min-w-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center justify-between w-full min-w-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white mb-2 truncate">{t('brand.name')}</h3>
            <p className="text-sm text-gray-400 max-w-md">{t('footer.description')}</p>
          </div>
          <div className="md:text-end text-sm text-gray-500 min-w-0">
            <p>{t('footer.rights')}</p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
