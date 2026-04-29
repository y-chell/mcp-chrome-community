import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { TOOL_NAMES } from 'chrome-mcp-shared';

type TabGroupAction = 'list' | 'create' | 'update' | 'move' | 'ungroup';
type TabGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

interface TabGroupToolParams {
  action: TabGroupAction;
  tabIds?: number[];
  groupId?: number;
  title?: string;
  color?: TabGroupColor;
  collapsed?: boolean;
  windowId?: number;
  index?: number;
}

function jsonSuccess(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false,
  };
}

function hasTabGroupsApi(): boolean {
  return !!(chrome as any).tabGroups;
}

function normalizeTabIds(tabIds: unknown): number[] {
  if (!Array.isArray(tabIds)) return [];
  return tabIds.filter((id): id is number => Number.isInteger(id) && id >= 0);
}

function buildUpdateProperties(args: TabGroupToolParams) {
  const props: Record<string, unknown> = {};
  if (typeof args.title === 'string') props.title = args.title;
  if (typeof args.color === 'string') props.color = args.color;
  if (typeof args.collapsed === 'boolean') props.collapsed = args.collapsed;
  return props;
}

function serializeTab(tab: chrome.tabs.Tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    pinned: tab.pinned,
    index: tab.index,
  };
}

async function serializeGroup(group: chrome.tabGroups.TabGroup) {
  const tabs = await chrome.tabs.query({ groupId: group.id } as chrome.tabs.QueryInfo);
  return {
    groupId: group.id,
    windowId: group.windowId,
    title: group.title || '',
    color: group.color,
    collapsed: group.collapsed,
    tabCount: tabs.length,
    tabIds: tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number'),
    tabs: tabs.map(serializeTab),
  };
}

class TabGroupTool {
  name = TOOL_NAMES.BROWSER.TAB_GROUP;

  async execute(args: TabGroupToolParams): Promise<ToolResult> {
    const action = args?.action;
    if (!action) return createErrorResponse('action is required');
    if (!hasTabGroupsApi()) {
      return createErrorResponse('chrome.tabGroups API is not available in this browser');
    }

    try {
      switch (action) {
        case 'list': {
          const groups = await chrome.tabGroups.query(
            typeof args.windowId === 'number' ? { windowId: args.windowId } : {},
          );
          const filteredGroups =
            typeof args.groupId === 'number'
              ? groups.filter((group) => group.id === args.groupId)
              : groups;
          const serialized = await Promise.all(filteredGroups.map(serializeGroup));
          return jsonSuccess({
            success: true,
            action,
            groupCount: serialized.length,
            groups: serialized,
          });
        }

        case 'create': {
          const tabIds = normalizeTabIds(args.tabIds);
          if (tabIds.length === 0) return createErrorResponse('tabIds is required for create');
          const groupOptions: chrome.tabs.GroupOptions = { tabIds };
          if (typeof args.windowId === 'number') {
            groupOptions.createProperties = { windowId: args.windowId };
          }
          const groupId = await chrome.tabs.group(groupOptions);
          const updateProperties = buildUpdateProperties(args);
          const group =
            Object.keys(updateProperties).length > 0
              ? await chrome.tabGroups.update(
                  groupId,
                  updateProperties as chrome.tabGroups.UpdateProperties,
                )
              : await chrome.tabGroups.get(groupId);
          return jsonSuccess({
            success: true,
            action,
            group: await serializeGroup(group),
          });
        }

        case 'update': {
          if (!Number.isInteger(args.groupId)) return createErrorResponse('groupId is required');
          const updateProperties = buildUpdateProperties(args);
          if (Object.keys(updateProperties).length === 0) {
            return createErrorResponse('Provide title, color, or collapsed for update');
          }
          const group = await chrome.tabGroups.update(
            args.groupId!,
            updateProperties as chrome.tabGroups.UpdateProperties,
          );
          return jsonSuccess({
            success: true,
            action,
            group: await serializeGroup(group),
          });
        }

        case 'move': {
          if (!Number.isInteger(args.groupId)) return createErrorResponse('groupId is required');
          if (!Number.isInteger(args.index)) return createErrorResponse('index is required');
          const moveProperties: chrome.tabGroups.MoveProperties = { index: args.index! };
          if (typeof args.windowId === 'number') moveProperties.windowId = args.windowId;
          const group = await chrome.tabGroups.move(args.groupId!, moveProperties);
          return jsonSuccess({
            success: true,
            action,
            group: await serializeGroup(group),
          });
        }

        case 'ungroup': {
          let tabIds = normalizeTabIds(args.tabIds);
          if (tabIds.length === 0 && Number.isInteger(args.groupId)) {
            const tabs = await chrome.tabs.query({
              groupId: args.groupId,
            } as chrome.tabs.QueryInfo);
            tabIds = tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
          }
          if (tabIds.length === 0) {
            return createErrorResponse('Provide tabIds or groupId for ungroup');
          }
          await chrome.tabs.ungroup(tabIds);
          return jsonSuccess({
            success: true,
            action,
            ungroupedTabIds: tabIds,
            ungroupedCount: tabIds.length,
          });
        }

        default:
          return createErrorResponse(`Unsupported tab group action: ${action}`);
      }
    } catch (error) {
      return createErrorResponse(
        `Tab group ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const tabGroupTool = new TabGroupTool();
