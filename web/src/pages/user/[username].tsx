import defaultCover from '@/assets/img/defaultCover.png';
import { VerifiedIcon } from '@/components/icons/Verified';
import UserSidebarLinks from '@/components/common/UserSidebarLinks';
import NavBar from '@/components/layout/navBar';
import LoadingPlaceholder from '@/components/others/LoadingPlaceholder';
import UserAvatar from '@/components/others/UserAvatar';
import RoteList from '@/components/rote/roteList';
import ContainerWithSideBar from '@/layout/ContainerWithSideBar';
import type { ApiGetRotesParams, Profile, Rotes } from '@/types/main';
import { API_URL, get } from '@/utils/api';
import { useAPIGet, useAPIInfinite } from '@/utils/fetcher';
import { getRotesV2 } from '@/utils/roteApi';
import { Helmet } from '@dr.pogodin/react-helmet';
import Linkify from 'linkify-react';
import { Globe2, RefreshCw, Stars } from 'lucide-react';
import moment from 'moment';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

function UserPage() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.user' });
  const navigate = useNavigate();
  const { username }: any = useParams();
  const {
    data: userInfo,
    isLoading,
    error,
  } = useAPIGet<Profile>(username, () => get('/users/' + username).then((res) => res.data), {
    onError: (err: any) => {
      // 捕获所有错误情况，包括：
      // 1. 网络错误（后端挂掉、连接超时等）- 没有 response
      // 2. HTTP 错误状态码（404, 500, 502, 503 等）
      // 3. 业务错误（返回的数据格式不正确）
      const hasResponse = err?.response !== undefined;
      const status = err?.response?.status;

      // 如果是网络错误（没有 response）或任何错误状态码（>= 400），都跳转404
      // 这包括：后端挂掉、连接超时、404、500、502、503 等所有错误情况
      if (!hasResponse || (status && status >= 400)) {
        navigate('/404');
      }
    },
  });

  // 验证返回的数据是否有效
  // 如果数据加载完成但没有有效的用户信息，也跳转404
  useEffect(() => {
    // 只有在加载完成且没有错误时才验证数据
    // 如果 error 存在，onError 已经处理了跳转，这里不需要再处理
    if (!isLoading && !error) {
      // 验证用户信息是否有效：至少需要有 id 和 username
      // 如果返回的数据不是预期的用户信息格式，也跳转404
      if (!userInfo || typeof userInfo !== 'object' || !userInfo.id || !userInfo.username) {
        navigate('/404');
      }
    }
  }, [isLoading, error, userInfo, navigate]);

  const getPropsUserPublic = (
    pageIndex: number,
    _previousPageData: Rotes | null
  ): ApiGetRotesParams | null => ({
    apiType: 'userPublic',
    params: {
      username: username,
      skip: pageIndex * 20,
      limit: 20,
    },
  });

  const {
    data,
    mutate,
    loadMore,
    isLoading: isRoteLoading,
    isValidating,
  } = useAPIInfinite(getPropsUserPublic, getRotesV2, {
    initialSize: 0,
    revalidateFirstPage: false,
  });

  const refreshData = () => {
    if (isRoteLoading || isValidating) {
      return;
    }
    mutate();
  };

  // 如果数据无效，不渲染内容（useEffect 会处理跳转）
  if (!isLoading && (!userInfo || !userInfo.id || !userInfo.username)) {
    return null;
  }

  return isLoading ? (
    <LoadingPlaceholder className="h-dvh w-full" size={6} />
  ) : (
    <>
      <Helmet>
        <title>{userInfo?.nickname || userInfo?.username || t('helmet.loading')}</title>
        <meta name="description" content={userInfo?.description || t('helmet.defaultDesc')} />
        <link
          rel="alternate"
          type="application/rss+xml"
          title={`${userInfo?.nickname || userInfo?.username} RSS`}
          href={`${API_URL}/rss/${username}`}
        />
      </Helmet>

      <ContainerWithSideBar
        sidebar={<UserSidebarLinks username={username} appLabel={t('downloadApp')} />}
        sidebarHeader={
          <div className="flex items-center gap-2 p-3 text-lg font-semibold">
            <div className="flex items-center gap-2">
              <Stars className="size-5" />
              {t('sideBarTitle')}
            </div>
          </div>
        }
      >
        <NavBar
          title={
            <>
              <UserAvatar
                avatar={userInfo?.avatar}
                className="bg-background size-6 shrink-0 border sm:block"
              />
              <span className="inline-flex items-center gap-1">
                {userInfo?.nickname || userInfo?.username}
                {userInfo?.emailVerified && <VerifiedIcon className="text-theme size-4 shrink-0" />}
              </span>
            </>
          }
          onNavClick={refreshData}
        >
          {isLoading ||
            (isValidating && (
              <RefreshCw className="text-primary ml-auto size-4 animate-spin duration-300" />
            ))}
        </NavBar>
        <div className="pb-4">
          <div className="relative aspect-[3] max-h-80 w-full overflow-hidden">
            <img
              className="h-full w-full object-cover"
              src={userInfo?.cover || defaultCover}
              alt=""
            />
          </div>
          <div className="mx-4 flex h-16">
            {/* 主页顶部头像展示，shadcn Avatar 不支持 size 属性，直接用 className 控制尺寸 */}
            <UserAvatar
              avatar={userInfo?.avatar}
              className="bg-background size-20 shrink-0 translate-y-[-50%] border-[4px] sm:block"
              fallbackClassName="bg-muted/80"
            />
          </div>
          <div className="mx-4 flex flex-col gap-1">
            <div className="inline-flex items-center gap-1 text-2xl font-semibold">
              {userInfo?.nickname}
              {userInfo?.emailVerified && <VerifiedIcon className="text-theme size-5 shrink-0" />}
            </div>
            <div className="text-info text-base">@{userInfo?.username}</div>
            <div className="text-base">
              <div className="aTagStyle break-words whitespace-pre-line">
                <Linkify>{(userInfo?.description as any) || t('noDescription')}</Linkify>
              </div>
            </div>
            <div className="text-info text-base">
              {`${t('registerTime')}${moment(userInfo?.createdAt).local().format('YYYY/MM/DD HH:mm:ss')}`}
            </div>
          </div>
        </div>

        <div className="bg-background flex w-full items-center gap-2 px-2 py-4 text-lg font-semibold">
          <Globe2 className="ml-2 size-6" />
          {t('publicNotes')}
        </div>

        {userInfo && <RoteList data={data} loadMore={loadMore} mutate={mutate} />}
      </ContainerWithSideBar>
    </>
  );
}

export default UserPage;
