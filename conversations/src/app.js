import {
  Channel,
  ConversationsViewer,
  getComponents,
  Message,
  Messages,
  User,
} from "./components.js";
import { nowDayOffset } from "./date.js";
import { httpFetcher, walk } from "./indexloader.js";
import { tutuca } from "./ui.js";

function parseParams() {
  const params = new URLSearchParams(window.location.search);
  const toDate = new Date(params.get("to-date") ?? nowDayOffset(1));
  const fromDate = new Date(params.get("from-date") ?? nowDayOffset(-7));
  const selected = params.get("selected") ?? null;
  const showReplies = params.get("show-replies") !== "false";
  const showReactions = params.get("show-reactions") !== "false";
  const showAttachments = params.get("show-attachments") !== "false";
  const showChannel = params.get("show-channel") !== "false";
  return {
    fromDate,
    toDate,
    selected,
    showReplies,
    showReactions,
    showAttachments,
    showChannel,
  };
}

async function main() {
  const { fromDate, toDate, selected, showReplies, showReactions, showAttachments, showChannel } =
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
  const repliesByTs = {};
  const topMsgsByTs = {};
  const msgsByTs = {};
  function onDayData(data, _info) {
    for (const msg of data) {
      const { type, ts, thread_ts: threadTs } = msg;
      if (type !== "message") {
        console.log("not message", msg);
        continue;
      }

      if (threadTs === undefined || ts === threadTs) {
        if (topMsgsByTs[ts] !== undefined) {
          console.warn("two top msgs with same ts?", msg);
        }
        topMsgsByTs[ts] = msg;
      } else {
        repliesByTs[threadTs] ??= [];
        repliesByTs[threadTs].push(msg);
      }
    }

    const orphanReplies = {};
    const orphanDates = new Set();
    for (const ts in repliesByTs) {
      const replies = repliesByTs[ts];
      const topMsg = topMsgsByTs[ts];
      if (topMsg === undefined) {
        orphanReplies[ts] = replies;
        const date = new Date(+ts * 1000).toISOString().split("T")[0];
        orphanDates.add(date);
        continue;
      }

      topMsg.thread_replies = replies;
      msgsByTs[ts] = topMsg;
    }
  }
  await walk(fetcher, fromDate, toDate, onDayData);
  let activeMessage = null;
  if (selected !== null && topMsgsByTs[selected]) {
    activeMessage = Message.Class.fromData(topMsgsByTs[selected], ctx);
  }

  for (const ts in topMsgsByTs) {
    items.push(Message.Class.fromData(topMsgsByTs[ts], ctx));
  }
  console.log(topMsgsByTs);

  items.sort((a, b) => a.date - b.date);
  const messages = Messages.make({ items });

  let rootState = ConversationsViewer.make({ messages, activeMessage });
  if (!showReplies) {
    rootState = rootState.setShowReplies(false);
  }
  if (!showReactions) {
    rootState = rootState.setShowReactions(false);
  }
  if (!showAttachments) {
    rootState = rootState.setShowAttachments(false);
  }
  if (!showChannel) {
    rootState = rootState.setShowChannel(false);
  }

  const app = tutuca("#app");
  app.state.set(rootState);
  app.registerComponents(getComponents());
  app.start();
}

main();
