import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(): Promise<ToolResult> {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      let tabCount = 0;

      const structuredWindows = windows.map((window) => {
        const tabs =
          window.tabs?.map((tab) => {
            tabCount++;
            return {
              tabId: tab.id || 0,
              windowId: tab.windowId || window.id || 0,
              url: tab.url || '',
              title: tab.title || '',
              active: tab.active || false,
              status: tab.status || 'unknown',
              openerTabId: tab.openerTabId,
              index: tab.index,
            };
          }) || [];

        return {
          windowId: window.id || 0,
          focused: window.focused || false,
          state: window.state || 'unknown',
          type: window.type || 'normal',
          top: window.top,
          left: window.left,
          width: window.width,
          height: window.height,
          activeTabId: tabs.find((tab) => tab.active)?.tabId || null,
          tabs: tabs,
        };
      });

      const result = {
        windowCount: windows.length,
        tabCount: tabCount,
        windows: structuredWindows,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in WindowTool.execute:', error);
      return createErrorResponse(
        `Error getting windows and tabs information: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const windowTool = new WindowTool();
