import UserSidebarLinks from '@/components/common/UserSidebarLinks';
import { profileAtom } from '@/state/profile';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

export default function ProfileSidebar() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.user' });
  const profile = useAtomValue(profileAtom);
  return <UserSidebarLinks username={profile?.username} appLabel={t('downloadApp')} />;
}
