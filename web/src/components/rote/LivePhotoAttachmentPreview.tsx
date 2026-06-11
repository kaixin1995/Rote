import { cn } from '@/lib/utils';
import type { Attachment } from '@/types/main';
import { getAttachmentLivePhotoPlaybackSrc } from '@/utils/directUpload';
import { SunMedium } from 'lucide-react';
import { useEffect, useState, type ComponentProps, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PhotoView } from 'react-photo-view';

type PhotoRenderParams = Parameters<NonNullable<ComponentProps<typeof PhotoView>['render']>>[0];

const DEFAULT_PREVIEW_SIZE = {
  width: 1280,
  height: 960,
};

interface LivePhotoAttachmentPreviewProps {
  attachment: Attachment;
  previewSrc: string;
  thumbnailSrc: string;
  className?: string;
  imageClassName?: string;
  badgeClassName?: string;
  crossOrigin?: 'anonymous';
}

function LivePhotoStill({
  thumbnailSrc,
  imageClassName,
  badgeClassName,
  crossOrigin,
  badgeLabel,
  onLoad,
}: Pick<
  LivePhotoAttachmentPreviewProps,
  'thumbnailSrc' | 'imageClassName' | 'badgeClassName' | 'crossOrigin'
> & {
  badgeLabel: string;
  onLoad?: (_event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  return (
    <>
      <img
        className={imageClassName}
        src={thumbnailSrc}
        crossOrigin={crossOrigin}
        alt=""
        draggable={false}
        onLoad={onLoad}
      />
      <span
        className={cn(
          'absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-white',
          badgeClassName
        )}
      >
        <SunMedium className="size-3" />
        {badgeLabel}
      </span>
    </>
  );
}

export function LivePhotoAttachmentPreview({
  attachment,
  previewSrc,
  thumbnailSrc,
  className,
  imageClassName,
  badgeClassName,
  crossOrigin,
}: LivePhotoAttachmentPreviewProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.attachments.livePhoto' });
  const [previewSize, setPreviewSize] = useState(DEFAULT_PREVIEW_SIZE);
  const [videoFailed, setVideoFailed] = useState(false);
  const playbackSrc = getAttachmentLivePhotoPlaybackSrc(attachment);

  useEffect(() => {
    setVideoFailed(false);
  }, [playbackSrc]);

  const handleStillLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalWidth || !naturalHeight) return;

    setPreviewSize((current) => {
      if (current.width === naturalWidth && current.height === naturalHeight) {
        return current;
      }

      return {
        width: naturalWidth,
        height: naturalHeight,
      };
    });
  };

  const renderLivePhoto = ({ attrs }: PhotoRenderParams) => {
    const mediaProps = {
      ...attrs,
      className: cn('PhotoView__Photo bg-black object-contain', attrs.className),
    };

    if (videoFailed) {
      return <img {...mediaProps} src={previewSrc} alt="" draggable={false} />;
    }

    return (
      <video
        {...mediaProps}
        src={playbackSrc}
        poster={previewSrc || undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-label={t('videoLabel')}
        onError={() => setVideoFailed(true)}
      />
    );
  };

  if (!playbackSrc) {
    return (
      <PhotoView src={previewSrc}>
        <div className={cn('relative grow overflow-hidden', className)}>
          <LivePhotoStill
            thumbnailSrc={thumbnailSrc}
            imageClassName={imageClassName}
            badgeClassName={badgeClassName}
            crossOrigin={crossOrigin}
            badgeLabel={t('badge')}
            onLoad={handleStillLoad}
          />
        </div>
      </PhotoView>
    );
  }

  return (
    <PhotoView
      key={`${playbackSrc}-${previewSize.width}x${previewSize.height}`}
      render={renderLivePhoto}
      width={previewSize.width}
      height={previewSize.height}
    >
      <div
        className={cn(
          'relative grow cursor-zoom-in overflow-hidden focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none',
          className
        )}
        aria-label={t('open')}
      >
        <LivePhotoStill
          thumbnailSrc={thumbnailSrc}
          imageClassName={imageClassName}
          badgeClassName={badgeClassName}
          crossOrigin={crossOrigin}
          badgeLabel={t('badge')}
          onLoad={handleStillLoad}
        />
      </div>
    </PhotoView>
  );
}
