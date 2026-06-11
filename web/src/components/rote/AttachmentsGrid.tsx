import type { Attachment } from '@/types/main';
import { getAttachmentMediaKind } from '@/utils/directUpload';
import { CirclePlay } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { VideoAttachmentPreview } from './VideoAttachmentPreview';
import 'react-photo-view/dist/react-photo-view.css';

interface AttachmentsGridProps {
  attachments: Attachment[];
  withTimeStamp?: boolean;
}

/**
 * AttachmentsGrid 组件 - 用于显示附件网格
 * 支持1-9张图片的自适应布局
 */
export default function AttachmentsGrid({ attachments, withTimeStamp }: AttachmentsGridProps) {
  const sortedAttachments = [...attachments].sort((a, b) => (a.sortIndex > b.sortIndex ? 1 : -1));
  const hasVideo = sortedAttachments.some(
    (attachment) => getAttachmentMediaKind(attachment) === 'video'
  );

  return (
    attachments.length > 0 && (
      <div className="my-2 flex w-fit flex-wrap gap-1 overflow-hidden rounded-2xl">
        {hasVideo ? (
          sortedAttachments.map((file, index) => (
            <VideoAttachmentPreview
              key={`files_${index}`}
              className="bg-foreground/3 w-full max-w-[500px] rounded-2xl border-[0.5px]"
              mediaClassName="h-full w-full object-contain"
              playbackSrc={file.url}
              posterSrc={file.posterUrl}
            />
          ))
        ) : (
          <PhotoProvider>
            {sortedAttachments.map((file, index) => {
              const isLivePhoto = getAttachmentMediaKind(file) === 'livePhoto';
              const imageClassName =
                attachments.length % 3 === 0
                  ? 'aspect-square w-[calc(1/3*100%-4px)]'
                  : attachments.length % 2 === 0
                    ? 'aspect-square w-[calc(1/2*100%-3px)]'
                    : attachments.length === 1
                      ? 'w-full max-w-[500px] rounded-2xl border-[0.5px]'
                      : 'aspect-square w-[calc(1/3*100%-3px)]';
              const renderedImageClassName =
                attachments.length === 1
                  ? 'bg-foreground/3 block w-full object-cover'
                  : 'bg-foreground/3 block h-full w-full object-cover';

              return (
                <PhotoView key={`files_${index}`} src={file.url}>
                  <div className={`${imageClassName} relative grow overflow-hidden`}>
                    <img
                      className={renderedImageClassName}
                      src={`${file.compressUrl || file.url}`}
                      crossOrigin={withTimeStamp ? 'anonymous' : undefined}
                      alt=""
                    />
                    {isLivePhoto && (
                      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-white">
                        <CirclePlay className="size-3" />
                        LIVE
                      </span>
                    )}
                  </div>
                </PhotoView>
              );
            })}
          </PhotoProvider>
        )}
      </div>
    )
  );
}
