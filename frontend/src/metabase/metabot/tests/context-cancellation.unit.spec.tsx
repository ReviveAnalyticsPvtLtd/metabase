import userEvent from "@testing-library/user-event";

import { act, screen, waitFor } from "__support__/ui";
import { useRegisterMetabotContextProvider } from "metabase/metabot";
import { useMetabotConversation } from "metabase/metabot/hooks/use-metabot-conversation";
import { getMessages, submitInput } from "metabase/metabot/state";
import { Button } from "metabase/ui";

import {
  mockAgentEndpoint,
  setup,
  testConversationId,
  whoIsYourFavoriteResponse,
} from "./utils";

const conversationId = testConversationId("omnibot");
const emptyContext = {
  user_is_viewing: [],
  current_time_with_timezone: "",
  capabilities: [],
};

function setupCancellation() {
  let resolveContext: () => void = () => {};
  const pendingContext = new Promise<void>((resolve) => {
    resolveContext = resolve;
  });
  const contextProvider = jest.fn(() => pendingContext);

  function Harness() {
    useRegisterMetabotContextProvider(contextProvider);
    const { submitInput, retryMessage, cancelRequest, messages } =
      useMetabotConversation(conversationId);
    return (
      <>
        <Button onClick={() => submitInput("Create an analysis")}>
          Submit
        </Button>
        <Button
          onClick={() => {
            const message = messages.at(-1);
            if (message) {
              retryMessage(message.id);
            }
          }}
        >
          Retry
        </Button>
        <Button onClick={cancelRequest}>Cancel</Button>
      </>
    );
  }

  const result = setup({ ui: <Harness /> });
  return { ...result, contextProvider, resolveContext };
}

describe("metabot > cancellation during context collection", () => {
  it("does not submit after context collection is cancelled", async () => {
    const { store, contextProvider, resolveContext } = setupCancellation();
    const agentSpy = mockAgentEndpoint({ events: whoIsYourFavoriteResponse });

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(contextProvider).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => resolveContext());

    expect(agentSpy).not.toHaveBeenCalled();
    expect(getMessages(store.getState(), conversationId)).toHaveLength(0);
  });

  it("does not submit when the conversation surface unmounts during context collection", async () => {
    const { store, rerender, contextProvider, resolveContext } =
      setupCancellation();
    const agentSpy = mockAgentEndpoint({ events: whoIsYourFavoriteResponse });
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(contextProvider).toHaveBeenCalledTimes(1));
    rerender(<div />);
    await act(async () => resolveContext());
    expect(agentSpy).not.toHaveBeenCalled();
    expect(getMessages(store.getState(), conversationId)).toHaveLength(0);
  });

  it("does not rewind or submit a retry after context collection is cancelled", async () => {
    const { store, contextProvider, resolveContext } = setupCancellation();
    mockAgentEndpoint({ events: whoIsYourFavoriteResponse });
    await act(async () => {
      await store.dispatch(
        submitInput({
          type: "text",
          message: "Create an analysis",
          context: emptyContext,
          conversationId,
        }),
      );
    });
    const messages = getMessages(store.getState(), conversationId);
    const agentSpy = mockAgentEndpoint({ events: whoIsYourFavoriteResponse });
    agentSpy.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(contextProvider).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => resolveContext());

    expect(agentSpy).not.toHaveBeenCalled();
    expect(getMessages(store.getState(), conversationId)).toEqual(messages);
  });
});
