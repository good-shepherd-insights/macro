import { BlockLink } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId } from '@core/user';
import { DisplayName } from '@entity/components/DisplayName';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { createMyActivityQuery } from '@queries/activity/graphql/feed';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { describeAction } from './describe-action';

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

/** The user's own activity, newest first, behind the activity-feed flag. */
export function MyActivityView() {
  const feed = createMyActivityQuery({ enabled: () => true });
  const events = () => feed.data ?? [];

  return (
    <div class="h-full overflow-y-auto">
      <div class="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 class="mb-6 text-lg font-semibold">Activity</h1>
        <Show
          when={events().length > 0}
          fallback={
            <p class="text-sm text-text-secondary">
              {feed.isLoading
                ? 'Loading…'
                : feed.isError
                  ? 'Activity is unavailable right now. Try again in a moment.'
                  : 'No activity yet.'}
            </p>
          }
        >
          <div class="flex flex-col divide-y divide-edge-muted">
            <For each={events()}>{(event) => <FeedRow event={event} />}</For>
          </div>
          <Show when={feed.hasNextPage}>
            <div class="mt-4 flex justify-center">
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
    </div>
  );
}

function FeedRow(props: { event: ActivityEvent }) {
  const actorId = () => tryMacroId(props.event.actorId);
  const entityType = () => displayEntityType(props.event.entityType);

  return (
    <div class="flex min-w-0 items-center gap-2 py-2.5 text-sm">
      <Show
        when={actorId()}
        fallback={<span class="shrink-0 text-text-secondary">Automation</span>}
      >
        {(id) => (
          <>
            <UserIcon id={id()} size="sm" showTooltip={false} />
            <span class="shrink-0 font-medium">
              <DisplayName id={id()} format="firstName" />
            </span>
          </>
        )}
      </Show>
      <span class="shrink-0 text-text-secondary">
        {describeAction(props.event.action)}
      </span>
      <Show when={entityType()}>
        {(type) => (
          <EntityRef entityId={props.event.entityId} entityType={type()} />
        )}
      </Show>
      <span class="ml-auto shrink-0 text-xs text-text-secondary">
        {formatRelativeTimestamp(new Date(props.event.occurredAt), {
          condensed: true,
        })}
      </span>
    </div>
  );
}

function EntityRef(props: { entityId: string; entityType: EntityType }) {
  const { name, icon, blockOrFileType, linkParams } = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType
  );

  const content = (
    <span class="inline-flex min-w-0 items-center gap-1.5">
      <span class="shrink-0">{icon()}</span>
      <span class="truncate">{name()}</span>
    </span>
  );

  return (
    <span class="min-w-0 truncate">
      <Show when={blockOrFileType()} fallback={content}>
        {(linkType) => (
          <BlockLink
            blockOrFileName={linkType()}
            id={props.entityId}
            params={linkParams()}
          >
            {content}
          </BlockLink>
        )}
      </Show>
    </span>
  );
}
