import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId } from '@core/user';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { createMyActivityQuery } from '@queries/activity/graphql/feed';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { ActorName } from './actor-name';
import { actionAsPropertyChange, describeAction } from './describe-action';
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
        <span class="text-sm font-semibold">Activity</span>
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <Show
            when={groups().length > 0}
            fallback={
              <p class="px-3 py-2 text-sm text-text-secondary">
                {feed.isLoading
                  ? 'Loading…'
                  : feed.isError
                    ? 'Activity is unavailable right now. Try again in a moment.'
                    : 'No activity yet.'}
              </p>
            }
          >
            <For each={groups()}>
              {(group) => (
                <>
                  <SoupSectionHeader>{group.label}</SoupSectionHeader>
                  <For each={group.events}>
                    {(event) => <FeedRow event={event} />}
                  </For>
                </>
              )}
            </For>
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

function FeedRow(props: { event: ActivityEvent }) {
  const actorMacroId = () => tryMacroId(props.event.actorId);
  const entityType = () => displayEntityType(props.event.entityType);

  return (
    <div class="mx-1 flex min-h-10 w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-0.5 text-sm hover:bg-hover/30">
      <Show when={actorMacroId()}>
        {(id) => <UserIcon id={id()} size="sm" showTooltip={false} />}
      </Show>
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0 font-medium">
          <ActorName actorId={props.event.actorId} />
        </span>
        <span class="min-w-0 shrink-0 text-ink-muted">
          <Show
            when={actionAsPropertyChange(props.event.action)}
            fallback={describeAction(props.event.action)}
          >
            {(change) => <PropertyChangeText action={change()} />}
          </Show>
        </span>
        <Show when={entityType()}>
          {(type) => (
            <span class="min-w-0 truncate">
              <EntityMention
                entityId={props.event.entityId}
                entityType={type()}
              />
            </span>
          )}
        </Show>
      </span>
      <span class="ml-auto shrink-0 text-right text-xs font-medium text-ink-extra-muted">
        {formatRelativeTimestamp(new Date(props.event.occurredAt), {
          condensed: true,
        })}
      </span>
    </div>
  );
}
