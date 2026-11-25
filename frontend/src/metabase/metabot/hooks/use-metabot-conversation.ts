import { isFulfilled } from "@reduxjs/toolkit";
import { useCallback, useEffect, useRef } from "react";

import { useMetabotContext } from "metabase/metabot";
import { useDispatch, useSelector } from "metabase/redux";
import { useMaybeLocation } from "metabase/router";
import * as Urls from "metabase/urls";

import { trackMetabotRequestSent } from "../analytics";
import type { MetabotProfileId } from "../constants";
import {
  type MetabotPromptSubmissionResult,
  type MetabotUserChatMessage,
  cancelInflightConversationRequests,
  fetchConversationSnapshot,
  getActiveToolCalls,
  getContextUsagePercent,
  getConversationForkedFrom,
  getConversationTitle,
  getDebugMode,
  getIsConversationProcessing,
  getLongChatNotice,
  getMessages,
  getMetabotId,
  getMetabotReactionsState,
  getMetabotRequestId,
  getProfile,
  retryPrompt,
  setProfileOverride as setProfileOverrideAction,
  submitInput as submitInputAction,
} from "../state";

import { useIsFullPageMetabot } from "./use-is-full-page-metabot";

export type SubmitInputOptions = {
  profile?: MetabotProfileId | undefined;
  focusInput?: boolean;
  onBeforeSubmit?: () => void;
};

/**
 * Drive a conversation by id rather than through a surface. Two surfaces showing the same
 * conversation observe one record, so neither can fall behind the other.
 */
export const useMetabotConversation = (conversationId: string) => {
  const dispatch = useDispatch();
  const contextAbortController = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      contextAbortController.current?.abort();
      contextAbortController.current = null;
    };
  }, [conversationId]);
  const { prompt, setPrompt, promptInputRef, getChatContext } =
    useMetabotContext();

  // `null` when rendered outside the app router (e.g. the SDK), where there is
  // no transforms page. Drives the transforms-codegen profile auto-selection
  // that used to read the retired routing slice.
  const location = useMaybeLocation();
  const isTransformsPage =
    location?.pathname.startsWith(Urls.transformList()) ?? false;
  const isFullPageMetabot = useIsFullPageMetabot();

  const metabotRequestId = useSelector((state) =>
    getMetabotRequestId(state, conversationId),
  );
  const isDoingScience = useSelector((state) =>
    getIsConversationProcessing(state, conversationId),
  );

  const prepareRetryIfUnsuccesful = useCallback(
    (result: MetabotPromptSubmissionResult) => {
      if (!result.success && result.shouldRetry) {
        promptInputRef?.current?.focus();
        setPrompt(result.prompt);
      }
    },
    [promptInputRef, setPrompt],
  );

  const setProfileOverride = useCallback(
    (profile: MetabotProfileId | undefined) => {
      dispatch(setProfileOverrideAction({ conversationId, profile }));
    },
    [dispatch, conversationId],
  );

  const submitInput = useCallback(
    async (
      prompt: string | Omit<MetabotUserChatMessage, "id" | "role">,
      options?: SubmitInputOptions,
    ) => {
      // One conversation may have only one active turn. Blocking duplicate
      // submits here prevents double-clicks and re-rendered handlers from
      // starting competing streams, which can otherwise look like an agent
      // loop and leave the conversation in an indeterminate state.
      if (isDoingScience) {
        return;
      }

      contextAbortController.current?.abort();
      const contextController = new AbortController();
      contextAbortController.current = contextController;

      setPrompt("");
      options?.onBeforeSubmit?.();

      if (options?.focusInput) {
        promptInputRef?.current?.focus();
      }

      const context = await getChatContext(contextController.signal);
      if (contextController.signal.aborted) {
        return;
      }

      const action = await dispatch(
        submitInputAction({
          ...(typeof prompt === "string"
            ? { type: "text", message: prompt }
            : prompt),
          context,
          conversationId,
          metabot_id: metabotRequestId,
          profile: options?.profile,
          isTransformsPage,
          isFullPageMetabot,
        }),
      );

      if (contextAbortController.current === contextController) {
        contextAbortController.current = null;
      }

      trackMetabotRequestSent();

      if (isFulfilled(action)) {
        prepareRetryIfUnsuccesful(action.payload);
      }

      return action;
    },
    [
      dispatch,
      getChatContext,
      metabotRequestId,
      prepareRetryIfUnsuccesful,
      conversationId,
      promptInputRef,
      setPrompt,
      isTransformsPage,
      isFullPageMetabot,
      isDoingScience,
    ],
  );

  const retryMessage = useCallback(
    async (messageId: string, options?: { profile?: MetabotProfileId }) => {
      if (isDoingScience) {
        return;
      }

      contextAbortController.current?.abort();
      const contextController = new AbortController();
      contextAbortController.current = contextController;
      const context = await getChatContext(contextController.signal);
      if (contextController.signal.aborted) {
        return;
      }

      const action = await dispatch(
        retryPrompt({
          messageId,
          context,
          metabot_id: metabotRequestId,
          conversationId,
          profile: options?.profile,
          isTransformsPage,
          isFullPageMetabot,
        }),
      );
      if (contextAbortController.current === contextController) {
        contextAbortController.current = null;
      }
      if (isFulfilled(action)) {
        prepareRetryIfUnsuccesful(action.payload);
      }
    },
    [
      dispatch,
      getChatContext,
      metabotRequestId,
      prepareRetryIfUnsuccesful,
      conversationId,
      isTransformsPage,
      isFullPageMetabot,
      isDoingScience,
    ],
  );

  const cancelRequest = useCallback(() => {
    contextAbortController.current?.abort();
    contextAbortController.current = null;
    dispatch(cancelInflightConversationRequests(conversationId));
  }, [dispatch, conversationId]);

  const reloadConversation = useCallback(() => {
    dispatch(fetchConversationSnapshot(conversationId));
  }, [dispatch, conversationId]);

  const longChatNotice = useSelector((state) =>
    getLongChatNotice(state, conversationId),
  );

  return {
    conversationId,
    prompt,
    setPrompt,
    promptInputRef,
    setProfileOverride,
    submitInput,
    retryMessage,
    cancelRequest,
    reloadConversation,
    metabotId: useSelector(getMetabotId),
    profile: useSelector((state) =>
      getProfile(state, conversationId, isTransformsPage),
    ),
    title: useSelector((state) => getConversationTitle(state, conversationId)),
    forkedFromConversationId: useSelector((state) =>
      getConversationForkedFrom(state, conversationId),
    ),
    messages: useSelector((state) => getMessages(state, conversationId)),
    isDoingScience: useSelector((state) =>
      getIsConversationProcessing(state, conversationId),
    ),
    longChatNotice,
    isContextWindowFull: longChatNotice === "full",
    contextWindowPercentUsage: useSelector((state) =>
      getContextUsagePercent(state, conversationId),
    ),
    activeToolCalls: useSelector((state) =>
      getActiveToolCalls(state, conversationId),
    ),
    debugMode: useSelector(getDebugMode),
    reactions: useSelector(getMetabotReactionsState),
  };
};
