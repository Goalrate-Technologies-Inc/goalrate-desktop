/**
 * Focus IPC Contracts
 * Canonical channel names and payload/result contracts for Desktop Focus List IPC.
 */

import type {
  FocusListCloseDayInput,
  FocusListCloseDayResult,
  FocusListDay,
  FocusListGenerateInput,
  FocusListGetCurrentInput,
  FocusListNavigationClickInput,
  FocusListNavigationResult,
} from '../types/focus';

/**
 * IPC channels used by FocusService and Navigation flows.
 */
export const FOCUS_IPC_CHANNELS = {
  FOCUS_SERVICE_GENERATE: 'FocusService.generate',
  FOCUS_SERVICE_CLOSE_DAY: 'FocusService.closeDay',
  FOCUS_SERVICE_GET_CURRENT: 'FocusService.getCurrent',
  NAVIGATION_OPEN_TASK: 'Navigation.openTask',
} as const;

/**
 * Union of all focus IPC channel names.
 */
export type FocusIpcChannel = (typeof FOCUS_IPC_CHANNELS)[keyof typeof FOCUS_IPC_CHANNELS];

/**
 * Payload type map by focus IPC channel.
 */
export interface FocusIpcPayloadByChannel {
  [FOCUS_IPC_CHANNELS.FOCUS_SERVICE_GENERATE]: FocusListGenerateInput;
  [FOCUS_IPC_CHANNELS.FOCUS_SERVICE_CLOSE_DAY]: FocusListCloseDayInput;
  [FOCUS_IPC_CHANNELS.FOCUS_SERVICE_GET_CURRENT]: FocusListGetCurrentInput;
  [FOCUS_IPC_CHANNELS.NAVIGATION_OPEN_TASK]: FocusListNavigationClickInput;
}

/**
 * Result type map by focus IPC channel.
 */
export interface FocusIpcResultByChannel {
  [FOCUS_IPC_CHANNELS.FOCUS_SERVICE_GENERATE]: FocusListDay;
  [FOCUS_IPC_CHANNELS.FOCUS_SERVICE_CLOSE_DAY]: FocusListCloseDayResult;
  [FOCUS_IPC_CHANNELS.FOCUS_SERVICE_GET_CURRENT]: FocusListDay | null;
  [FOCUS_IPC_CHANNELS.NAVIGATION_OPEN_TASK]: FocusListNavigationResult;
}

/**
 * Typed IPC request envelope for a focus channel.
 */
export type FocusIpcRequest<TChannel extends FocusIpcChannel = FocusIpcChannel> = {
  channel: TChannel;
  payload: FocusIpcPayloadByChannel[TChannel];
};

/**
 * Typed IPC response envelope for a focus channel.
 */
export type FocusIpcResponse<TChannel extends FocusIpcChannel = FocusIpcChannel> = {
  channel: TChannel;
  result: FocusIpcResultByChannel[TChannel];
};

/**
 * Build a typed focus IPC request payload.
 */
export const createFocusIpcRequest = <TChannel extends FocusIpcChannel>(
  channel: TChannel,
  payload: FocusIpcPayloadByChannel[TChannel]
): FocusIpcRequest<TChannel> => ({
  channel,
  payload,
});
