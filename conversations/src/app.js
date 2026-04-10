import { tutuca } from "./ui.js";
import {
  getComponents,
  User,
  Channel,
  Message,
  Messages,
  ConversationsViewer,
} from "./components.js";
import { SlackDB } from "./slack.js";
import {
  nowDayOffset,
  dateParts,
  dateIsLessThanDate,
  addDays,
} from "./date.js";

function parseParams() {
  const params = new URLSearchParams(window.location.search);
  const channelsRaw = params.get("channels") ?? "share-your-work";
  const toDate = new Date(params.get("to-date") ?? nowDayOffset(1));
  const fromDate = new Date(params.get("from-date") ?? nowDayOffset(-7));
  const channels = channelsRaw.split(",");
  const currentChannel = channels[0];
  return { channels, currentChannel, fromDate, toDate };
}

async function main() {
  const {
    currentChannel,
    fromDate,
    toDate,
    channels: channelNames,
  } = parseParams();
  console.log({ fromDate, toDate });

  const isLocalhost = ["localhost", "127.0.0.1"].includes(
    window.location.hostname,
  );
  const useRemote =
    !isLocalhost ||
    new URLSearchParams(window.location.search).has("_devRemoteBaseUrl");
  const baseUrl = useRemote
    ? "https://marianoguerra.github.io/future-of-coding-weekly"
    : ".";
  const db = new SlackDB(baseUrl);
  const users = await db.fetchUsers();
  const channels = await db.fetchChannels();
  const usersById = {};
  for (const { id, name, real_name: realName } of users) {
    usersById[id] = User.make({ id, name, realName });
  }
  const channelsById = {};
  for (const { id, name, name_normalized: nameNormalized } of channels) {
    channelsById[id] = Channel.make({ id, name: nameNormalized ?? name });
  }
  const ctx = { usersById, channelsById };

  db.loadUserData(users);
  db.loadChannelData(channels);

  let curDate = fromDate;
  while (dateIsLessThanDate(curDate, toDate)) {
    const [year, month, day] = dateParts(curDate);
    for (const channel of channelNames) {
      await db.loadChannelDate(channel, year, month, day);
    }
    curDate = addDays(curDate, 1);
  }
  const r = [];
  for (const msg of db.iterMessagesInChannel(currentChannel)) {
    const message = Message.Class.fromData(msg, ctx);
    r.push(message);
  }
  let rootState = ConversationsViewer.make({
    messages: Messages.make({ items: r }),
  });
  const params = new URLSearchParams(window.location.search);
  if (params.get("show-replies") === "false") {
    rootState = rootState.setShowReplies(false);
  }
  if (params.get("show-reactions") === "false") {
    rootState = rootState.setShowReactions(false);
  }
  if (params.get("show-attachments") === "false") {
    rootState = rootState.setShowAttachments(false);
  }
  console.log(db, rootState);

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
