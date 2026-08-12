import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { createMyActivityQuery } from '@queries/activity/graphql/feed';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { Button } from '@ui';
import { type Component, createMemo, For, Show } from 'solid-js';
import { ActionGlyph } from './action-glyph';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import {
  actionAsPropertyChange,
  describeActionForEntity,
} from './describe-action';
import { EntityMention } from './entity-mention';
import { PropertyChangeText } from './property-change';

/**
 * Maps an activity event's canonical entity type onto the display vocabulary
 * used by the shared entity name/icon/link resolver. Types the resolver
 * can't render (teams, static files, …) return undefined and the row shows
 * without an entity reference.
 */
function displayEntityType(
  entityType: GraphqlEntityType
): EntityType | undefined {
  switch (entityType) {
    case 'DOCUMENT':
      return 'DOCUMENT';
    case 'PROJECT':
      return 'PROJECT';
    case 'CHAT':
      return 'CHAT';
    case 'EMAIL_THREAD':
      return 'THREAD';
    case 'CHANNEL':
      return 'CHANNEL';
    case 'CALL':
      return 'CALL_RECORD';
    case 'CALENDAR_EVENT':
      return 'CALENDAR_EVENT';
    case 'CRM_COMPANY':
      return 'COMPANY';
    case 'USER':
      return 'USER';
    default:
      return undefined;
  }
}

type FeedGroup = { key: string; label: string; events: ActivityEvent[] };

/** The user's own activity, newest first, behind the activity-feed flag. */
export function MyActivityView() {
  const feed = createMyActivityQuery({ enabled: () => true });
  const groups = createMemo<FeedGroup[]>(() => {
    const out: FeedGroup[] = [];
    for (const event of feed.data ?? []) {
      const bucket = dateBucket(event.occurredAt);
      const last = out[out.length - 1];
      if (last?.key === bucket.key) {
        last.events.push(event);
      } else {
        out.push({ ...bucket, events: [event] });
      }
    }
    return out;
  });

  return (
    <div class="@container/u-list flex size-full flex-col">
      <SplitHeaderLeft>
        <span class="font-semibold text-sm">Activity</span>
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <Show
            when={groups().length > 0}
            fallback={
              <p class="px-3 py-2 text-ink-muted text-sm">
                {feed.isLoading
                  ? 'Loading…'
                  : feed.isError
                    ? 'Activity is unavailable right now. Try again in a moment.'
                    : 'No activity yet.'}
              </p>
            }
          >
            <FeedGroups groups={groups()} row={SentenceTimelineRow} />
            <Show when={feed.hasNextPage}>
              <div class="flex justify-center py-2">
                <Button
                  variant="ghost"
                  onClick={() => void feed.fetchNextPage()}
                  disabled={feed.isFetchingNextPage}
                >
                  {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            </Show>
          </Show>
        </div>
      </StaticMarkdownContext>
    </div>
  );
}

function FeedGroups(props: {
  groups: FeedGroup[];
  row: Component<{ event: ActivityEvent }>;
}) {
  return (
    <For each={props.groups}>
      {(group) => (
        <>
          <SoupSectionHeader>{group.label}</SoupSectionHeader>
          <For each={group.events}>
            {(event) => <props.row event={event} />}
          </For>
        </>
      )}
    </For>
  );
}

function Timestamp(props: { event: ActivityEvent }) {
  return (
    <span class="ml-auto shrink-0 text-right font-medium text-ink-extra-muted text-xs">
      {formatRelativeTimestamp(new Date(props.event.occurredAt), {
        condensed: true,
      })}
    </span>
  );
}

/**
 * "<actor> <action> on <entity>": the glyph rail with a full sentence —
 * actor in medium weight, verb muted, the natural connector per action
 * kind, and the entity as a real mention.
 */
function SentenceTimelineRow(props: { event: ActivityEvent }) {
  const entityType = () => displayEntityType(props.event.entityType);
  const parts = () => describeActionForEntity(props.event.action);

  return (
    <div class="mx-1 flex w-[calc(100%-0.5rem)] items-stretch gap-1 px-2 text-sm">
      <div class="relative flex w-6 shrink-0 items-center justify-center">
        <div class="absolute inset-y-0 w-px bg-edge-muted" />
        <span class="relative flex size-5 items-center justify-center rounded-full bg-surface ring ring-edge-muted">
          <ActionGlyph
            action={props.event.action}
            class="size-3 text-ink-muted"
          />
        </span>
      </div>
      <div class="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30">
        <span class="shrink-0 font-medium">
          <ActorName actorId={props.event.actorId} />
        </span>
        <Show
          when={entityType()}
          fallback={
            <span class="min-w-0 truncate text-ink-muted">
              <ActionPhrase event={props.event} />
            </span>
          }
        >
          {(type) => (
            <>
              <span class="min-w-0 shrink-0 text-ink-muted">
                <Show
                  when={actionAsPropertyChange(props.event.action)}
                  fallback={parts().verb}
                >
                  {(change) => <PropertyChangeText action={change()} />}
                </Show>
              </span>
              <Show when={parts().connector}>
                {(connector) => (
                  <span class="shrink-0 text-ink-muted">{connector()}</span>
                )}
              </Show>
              <span class="min-w-0 truncate">
                <EntityMention
                  entityId={props.event.entityId}
                  entityType={type()}
                />
              </span>
            </>
          )}
        </Show>
        <Timestamp event={props.event} />
      </div>
    </div>
  );
}
