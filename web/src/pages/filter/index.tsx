import { StarsBackground } from '@/components/animate-ui/backgrounds/stars';
import { SlidingNumber } from '@/components/animate-ui/text/sliding-number';
import NavBar from '@/components/layout/navBar';
import LoadingPlaceholder from '@/components/others/LoadingPlaceholder';
import SearchBar from '@/components/others/SearchBox';
import RoteList from '@/components/rote/roteList';
import RoteItem from '@/components/rote/roteItem';
import { DatePicker } from '@/components/ui/date-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSiteStatus } from '@/hooks/useSiteStatus';
import ContainerWithSideBar from '@/layout/ContainerWithSideBar';
import { profileAtom } from '@/state/profile';
import { loadTagsAtom, tagsAtom } from '@/state/tags';
import type { ApiGetRotesParams, Rote, Rotes, Statistics } from '@/types/main';
import type { AiSemanticResult } from '@/utils/aiApi';
import { aiSearch } from '@/utils/aiApi';
import { get, post } from '@/utils/api';
import { useAPIGet, useAPIInfinite } from '@/utils/fetcher';
import { getRotesV2 } from '@/utils/roteApi';
import { format } from 'date-fns';
import { useAtomValue, useSetAtom } from 'jotai';
import { ActivityIcon, AlertCircle, Filter, MessageSquareDashed, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

type SearchMode = 'keyword' | 'semantic';

type SemanticSearchData = {
  results: AiSemanticResult[];
  rotes: Rotes;
};

function SideBar() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.filter' });
  const { isLoading, data: statisticsData } = useAPIGet<Statistics>('statistics', () =>
    get('/users/me/statistics').then((res) => res.data)
  );

  return isLoading ? (
    <LoadingPlaceholder className="py-8" size={6} />
  ) : (
    <div className="grid grid-cols-2 divide-x border-b">
      <div className="gap2 flex flex-col items-center justify-center py-4">
        <SlidingNumber
          className="font-mono text-xl font-black"
          number={statisticsData?.roteCount || 0}
        />
        <div className="font-light">{t('note')}</div>
      </div>
      <div className="gap2 flex flex-col items-center justify-center py-4">
        <SlidingNumber
          className="font-mono text-xl font-black"
          number={statisticsData?.attachmentCount || 0}
        />
        <div className="font-light">{t('attachment')}</div>
      </div>
    </div>
  );
}

function MineFilter() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.filter' });

  const tags = useAtomValue(tagsAtom);
  const profile = useAtomValue(profileAtom);
  const loadTags = useSetAtom(loadTagsAtom);
  const { data: siteStatus } = useSiteStatus();
  const canUseAi = siteStatus?.ai?.memoryAvailable === true && profile?.certified === true;

  useEffect(() => {
    if (tags === null) loadTags();
  }, [tags, loadTags]);

  const location = useLocation();

  const [filter, setFilter] = useState({
    tags: {
      hasEvery: location.state?.tags || [],
    },
    keyword: location.state?.initialKeyword || '',
    date: location.state?.date || '',
  });
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword');

  useEffect(() => {
    if (!canUseAi && searchMode === 'semantic') {
      setSearchMode('keyword');
    }
  }, [canUseAi, searchMode]);

  const getProps = useCallback(
    (pageIndex: number, _previousPageData: any): ApiGetRotesParams => {
      const params: any = {
        skip: pageIndex * 20,
        limit: 20,
      };

      if (filter.tags.hasEvery.length > 0) {
        params.tag = filter.tags.hasEvery;
      }

      if (filter.keyword.trim()) {
        params.keyword = filter.keyword.trim();
      }

      if (filter.date) {
        params.date = filter.date;
      }

      return {
        apiType: 'mine',
        params,
      };
    },
    [filter.tags.hasEvery, filter.keyword, filter.date]
  );

  const { data, mutate, loadMore, isLoading, isValidating, error, setSize } = useAPIInfinite(
    getProps,
    getRotesV2,
    {
      initialSize: 1,
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const semanticKey =
    canUseAi && searchMode === 'semantic' && filter.keyword.trim()
      ? {
          key: 'ai-semantic-search',
          keyword: filter.keyword.trim(),
          tags: filter.tags.hasEvery.join('|'),
          date: filter.date,
        }
      : null;

  const {
    data: semanticData,
    isLoading: semanticLoading,
    isValidating: semanticValidating,
    error: semanticError,
    mutate: mutateSemantic,
  } = useAPIGet<SemanticSearchData>(
    semanticKey,
    async () => {
      const results = await aiSearch({
        query: filter.keyword.trim(),
        scope: 'mine',
        sourceTypes: ['rote'],
        limit: 50,
        tags:
          filter.tags.hasEvery.length > 0
            ? { include: filter.tags.hasEvery, match: 'all' }
            : undefined,
        timeRange: filter.date
          ? {
              from: `${filter.date}T00:00:00.000Z`,
              to: `${filter.date}T23:59:59.999Z`,
            }
          : undefined,
      });
      const filteredResults = results.filter((result) => {
        const tags = Array.isArray(result.metadata?.tags) ? result.metadata.tags : [];
        const tagsMatched =
          filter.tags.hasEvery.length === 0 ||
          filter.tags.hasEvery.every((tag: string) => tags.includes(tag));
        const dateMatched =
          !filter.date ||
          (typeof result.metadata?.createdAt === 'string' &&
            result.metadata.createdAt.startsWith(filter.date));
        return tagsMatched && dateMatched;
      });
      const ids = filteredResults.map((result) => result.sourceId);

      if (ids.length === 0) {
        return { results: [], rotes: [] };
      }

      const response = await post('/notes/batch', { ids });
      const rotes = response.data as Rotes;
      const roteById = new Map(rotes.map((rote: Rote) => [rote.id, rote]));
      const orderedRotes = filteredResults
        .map((result) => roteById.get(result.sourceId))
        .filter((rote): rote is Rote => Boolean(rote));

      return {
        results: filteredResults.filter((result) => roteById.has(result.sourceId)),
        rotes: orderedRotes,
      };
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  // 当 filter 变化时，重置分页并重新验证
  const prevFilterRef = useRef<{
    tags: string[];
    keyword: string;
    date: string;
    mode: SearchMode;
  } | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // 跳过初始挂载
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevFilterRef.current = {
        tags: filter.tags.hasEvery,
        keyword: filter.keyword,
        date: filter.date,
        mode: searchMode,
      };
      return;
    }

    const currentTags = filter.tags.hasEvery;
    const currentKeyword = filter.keyword;
    const currentDate = filter.date;
    const currentMode = searchMode;
    const prevFilter = prevFilterRef.current;

    if (!prevFilter) {
      prevFilterRef.current = {
        tags: currentTags,
        keyword: currentKeyword,
        date: currentDate,
        mode: currentMode,
      };
      return;
    }

    // 检查是否真的发生了变化
    const tagsChanged =
      currentTags.length !== prevFilter.tags.length ||
      currentTags.some((tag: string, index: number) => tag !== prevFilter.tags[index]);
    const keywordChanged = currentKeyword !== prevFilter.keyword;
    const dateChanged = currentDate !== prevFilter.date;
    const modeChanged = currentMode !== prevFilter.mode;

    if (tagsChanged || keywordChanged || dateChanged || modeChanged) {
      // 更新引用
      prevFilterRef.current = {
        tags: currentTags,
        keyword: currentKeyword,
        date: currentDate,
        mode: currentMode,
      };
      if (currentMode === 'keyword') {
        // 重置到第一页并重新验证
        setSize(1);
        mutate();
      } else {
        void mutateSemantic();
      }
    }
  }, [
    filter.tags.hasEvery,
    filter.keyword,
    filter.date,
    searchMode,
    setSize,
    mutate,
    mutateSemantic,
  ]);

  // 处理错误提示
  useEffect(() => {
    const activeError = searchMode === 'semantic' ? semanticError : error;
    if (activeError) {
      const errorMessage =
        activeError?.response?.data?.message ||
        activeError?.message ||
        t('searchError', { defaultValue: '搜索失败，请稍后重试' });
      toast.error(errorMessage);
    }
  }, [error, semanticError, searchMode, t]);

  const refreshData = () => {
    const activeLoading = searchMode === 'semantic' ? semanticLoading : isLoading;
    const activeValidating = searchMode === 'semantic' ? semanticValidating : isValidating;
    if (activeLoading || activeValidating) {
      return;
    }
    if (searchMode === 'semantic') {
      void mutateSemantic();
    } else {
      mutate();
    }
  };

  const tagsClickHandler = useCallback((tag: string) => {
    setFilter((prevState) => {
      const newTags = prevState.tags.hasEvery.includes(tag)
        ? prevState.tags.hasEvery.filter((t: any) => t !== tag)
        : [...prevState.tags.hasEvery, tag];

      return {
        ...prevState,
        tags: {
          ...prevState.tags,
          hasEvery: newTags,
        },
      };
    });
  }, []);

  const TagsBlock = useMemo(
    () => (
      <StarsBackground
        pointerEvents={false}
        starColor="#3ECF4A"
        className="relative h-auto max-h-[25vh] overflow-hidden bg-none"
      >
        <div className="noScrollBar relative max-h-[25vh] space-y-4 overflow-y-scroll bg-none mask-[linear-gradient(180deg,#000000_calc(100%-20%),transparent)] p-4 font-semibold">
          <div className="relative flex flex-wrap items-center gap-2">
            {t('includeTags')}
            {filter.tags.hasEvery.length > 0
              ? filter.tags.hasEvery.map((tag: any, index: any) => (
                  <div
                    className="bg-foreground/5 cursor-pointer rounded-md px-2 py-1 text-xs font-normal duration-300 hover:scale-95"
                    key={`tag-${index}`}
                    onClick={() => tagsClickHandler(tag)}
                  >
                    {tag}
                  </div>
                ))
              : t('none')}
          </div>
          <div className="text-info relative flex flex-wrap items-center gap-2 font-normal">
            {t('allTags')}
            {tags && tags.length > 0
              ? tags.map((tag) => (
                  <div key={tag.name} onClick={() => tagsClickHandler(tag.name)}>
                    <div className="bg-foreground/5 divide-foreground/3 flex grow cursor-pointer items-center justify-between divide-x rounded-sm px-2 text-xs duration-300 hover:scale-95">
                      <div className="py-1 pr-1">{tag.name}</div>
                      {tag.count > 0 && (
                        <div className="text-theme py-1 pl-1 font-mono">{tag.count}</div>
                      )}
                    </div>
                  </div>
                ))
              : t('none')}
          </div>
        </div>
      </StarsBackground>
    ),
    [t, filter.tags.hasEvery, tags, tagsClickHandler]
  );

  const renderSemanticResults = () => {
    if (!filter.keyword.trim()) {
      return (
        <div className="bg-background flex shrink-0 flex-col items-center justify-center gap-4 py-8">
          <MessageSquareDashed className="text-theme/30 size-10" />
          <div className="text-info text-center font-light">{t('semantic.emptyQuery')}</div>
        </div>
      );
    }

    if (semanticLoading || semanticValidating) {
      return <LoadingPlaceholder className="py-12" size={6} />;
    }

    if (semanticError) {
      const errorMessage =
        semanticError?.response?.data?.message ||
        semanticError?.message ||
        t('searchError', { defaultValue: '搜索失败，请稍后重试' });
      return (
        <div className="bg-background flex shrink-0 flex-col items-center justify-center gap-4 py-8">
          <AlertCircle className="text-destructive size-10" />
          <div className="text-destructive text-center font-light">{errorMessage}</div>
        </div>
      );
    }

    if (!semanticData || semanticData.rotes.length === 0) {
      return (
        <div className="bg-background flex shrink-0 flex-col items-center justify-center gap-4 py-8">
          <MessageSquareDashed className="text-theme/30 size-10" />
          <div className="text-info text-center font-light">{t('semantic.empty')}</div>
        </div>
      );
    }

    return (
      <div className="relative flex w-full flex-col divide-y">
        {semanticData.rotes.map((rote) => (
          <RoteItem key={rote.id} rote={rote} />
        ))}
      </div>
    );
  };

  return (
    <ContainerWithSideBar
      sidebar={<SideBar />}
      sidebarHeader={
        <div className="flex items-center gap-2 p-3 text-lg font-semibold">
          <div className="flex items-center gap-2">
            <ActivityIcon className="size-5" />
            {t('data')}
          </div>
        </div>
      }
    >
      <NavBar title={t('title')} icon={<Filter className="size-5" />} onNavClick={refreshData}>
        <div className="ml-auto flex items-center gap-3">
          {canUseAi && (
            <ToggleGroup
              type="single"
              value={searchMode}
              onValueChange={(value) => {
                if (value === 'keyword' || value === 'semantic') {
                  setSearchMode(value);
                }
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="keyword" className="px-3 text-xs">
                {t('searchMode.keyword')}
              </ToggleGroupItem>
              <ToggleGroupItem value="semantic" className="px-3 text-xs">
                {t('searchMode.semantic')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {(searchMode === 'semantic'
            ? semanticLoading || semanticValidating
            : isLoading || isValidating) && (
            <RefreshCw className="text-primary size-4 animate-spin duration-300" />
          )}
        </div>
      </NavBar>

      <div className="flex w-full flex-col divide-y sm:flex-row sm:items-center sm:divide-x sm:divide-y-0">
        <SearchBar
          className="min-w-0 flex-1"
          defaultValue={filter.keyword}
          onSearch={(keyword) => {
            const trimmedKeyword = keyword.trim();
            setFilter((prevState) => ({
              ...prevState,
              keyword: trimmedKeyword,
            }));
          }}
          isLoading={
            searchMode === 'semantic'
              ? semanticLoading || semanticValidating
              : isLoading || isValidating
          }
        />
        <div className="flex shrink-0 items-center">
          <DatePicker
            date={filter.date ? new Date(filter.date) : undefined}
            className="rounded-none border-none bg-none"
            setDate={(date) => {
              setFilter((prev) => ({
                ...prev,
                date: date ? format(date, 'yyyy-MM-dd') : '',
              }));
            }}
          />
        </div>
      </div>
      {TagsBlock}
      {searchMode === 'semantic' ? (
        renderSemanticResults()
      ) : (
        <RoteList data={data} loadMore={loadMore} mutate={mutate} error={error} />
      )}
    </ContainerWithSideBar>
  );
}

export default MineFilter;
