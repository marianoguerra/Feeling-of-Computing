import {
  Channel,
  ConversationsViewer,
  getComponents,
  Message,
  Messages,
  PlainViewer,
  User,
} from "./components.js";
import { nowDayOffset } from "./date.js";
import { httpFetcher, walk } from "./indexloader.js";
import { tutuca } from "./ui.js";

function parseParams() {
  const params = new URLSearchParams(window.location.search);
  const toDate = new Date(params.get("to-date") ?? nowDayOffset(1));
  const fromDate = new Date(params.get("from-date") ?? nowDayOffset(-7));
  const showReplies = params.get("show-replies") !== "false";
  const showReactions = params.get("show-reactions") !== "false";
  const showAttachments = params.get("show-attachments") !== "false";
  const isPlainMode = params.get("plain-mode") === "true";
  return {
    fromDate,
    toDate,
    showReplies,
    showReactions,
    showAttachments,
    isPlainMode,
  };
}

async function main() {
  const { fromDate, toDate, showReplies, showReactions, showAttachments, isPlainMode } =
    parseParams();

  const fetcher = httpFetcher("../history");
  const users = await fetcher.fetchUsers();
  const channels = await fetcher.fetchChannels();
  const usersById = {};
  for (const { id, name, real_name: realName } of users) {
    usersById[id] = User.make({ id, name, realName });
  }
  const channelsById = {};
  for (const { id, name, name_normalized: nameNormalized } of channels) {
    channelsById[id] = Channel.make({ id, name: nameNormalized ?? name });
  }
  const ctx = { usersById, channelsById };

  const items = [];
  function onDayData(data, info) {
    console.log(info);
    for (const msg of data) {
      const message = Message.Class.fromData(msg, ctx);
      items.push(message);
      console.log(msg, message);
    }
  }
  await walk(fetcher, fromDate, toDate, onDayData);
  items.sort((a, b) => a.date - b.date);
  const messages = Messages.make({ items });

  let rootState = isPlainMode
    ? PlainViewer.make({ messages })
    : ConversationsViewer.make({ messages });
  if (!showReplies) {
    rootState = rootState.setShowReplies(false);
  }
  if (!showReactions) {
    rootState = rootState.setShowReactions(false);
  }
  if (!showAttachments) {
    rootState = rootState.setShowAttachments(false);
  }

  const app = tutuca("#app");
  app.state.set(rootState);
  app.registerComponents(getComponents());
  app.start();
  setTimeout(() => {
    const node = document.querySelector(`[href='${window.location.hash}']`);
    if (node) {
      node.scrollIntoView();
    }
  }, 500);
}

main();
