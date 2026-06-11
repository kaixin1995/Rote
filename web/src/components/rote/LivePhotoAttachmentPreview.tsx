import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/types/main';
import { getAttachmentLivePhotoPlaybackSrc } from '@/utils/directUpload';
import { SunMedium } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhotoView } from 'react-photo-view';

interface LivePhotoAttachmentPreviewProps {
  attachment: Attachment;
  previewSrc: string;
  thumbnailSrc: string;
  className?: string;
  imageClassName?: string;
  crossOrigin?: 'anonymous';
}

function LivePhotoStill({
  thumbnailSrc,
  imageClassName,
  crossOrigin,
  badgeLabel,
}: Pick<LivePhotoAttachmentPreviewProps, 'thumbnailSrc' | 'imageClassName' | 'crossOrigin'> & {
  badgeLabel: string;
}) {
  return (
    <>
      <img
        className={imageClassName}
        src={thumbnailSrc}
        crossOrigin={crossOrigin}
        alt=""
        draggable={false}
      />
      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-white">
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
  crossOrigin,
}: LivePhotoAttachmentPreviewProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.attachments.livePhoto' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const playbackSrc = getAttachmentLivePhotoPlaybackSrc(attachment);

  if (!playbackSrc) {
    return (
      <PhotoView src={previewSrc}>
        <div className={cn('relative grow overflow-hidden', className)}>
          <LivePhotoStill
            thumbnailSrc={thumbnailSrc}
            imageClassName={imageClassName}
            crossOrigin={crossOrigin}
            badgeLabel={t('badge')}
          />
        </div>
      </PhotoView>
    );
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setVideoFailed(false);
      return;
    }

    videoRef.current?.pause();
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          'relative grow cursor-zoom-in overflow-hidden bg-transparent p-0 text-left focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none',
          className
        )}
        aria-label={t('open')}
        onClick={() => handleOpenChange(true)}
      >
        <LivePhotoStill
          thumbnailSrc={thumbnailSrc}
          imageClassName={imageClassName}
          crossOrigin={crossOrigin}
          badgeLabel={t('badge')}
        />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden border-0 bg-black p-0 text-white shadow-none sm:max-w-5xl [&_[data-slot=dialog-close]]:text-white">
          <DialogTitle className="sr-only">{t('title')}</DialogTitle>
          <div className="relative flex max-h-[calc(100dvh-2rem)] min-h-[min(60dvh,30rem)] w-full items-center justify-center bg-black">
            {videoFailed ? (
              <div className="relative flex h-full w-full items-center justify-center">
                <img
                  className="max-h-[calc(100dvh-2rem)] max-w-full object-contain"
                  src={previewSrc}
                  alt=""
                />
                <div className="absolute right-4 bottom-4 left-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
                  {t('playbackFailed')}
                </div>
              </div>
            ) : (
              <video
                ref={videoRef}
                className="max-h-[calc(100dvh-2rem)] max-w-full bg-black object-contain"
                src={playbackSrc}
                poster={previewSrc || undefined}
                controls
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-label={t('videoLabel')}
                onError={() => setVideoFailed(true)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
