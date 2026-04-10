export class ChannelDB {
  constructor() {
    this.minDay = null;
    this.maxDay = null;
    this.msgsByTs = {};
    this.msgOrder = [];
    this.orphanReplies = {};
    this.orphanDates = new Set();
  }

  loadMessages(msgs, year, month, day) {
    const date = `${year}-${month}-${day}`;
    if (this.minDay === null || date < this.minDay) {
      this.minDay = date;
    }
    if (this.maxDay === null || date > this.maxDay) {
      this.maxDay = date;
    }
    const repliesByTs = {};
    const topMsgsByTs = {};
    for (const msg of msgs) {
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

    const { orphanReplies, orphanDates } = this;
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
      this.msgsByTs[ts] = topMsg;
      this.msgOrder.push(ts);
    }

    this.msgOrder.sort();
  }
  *iterMessages() {
    for (const ts of this.msgOrder) {
      yield this.msgsByTs[ts];
    }
  }
}

export class SlackDB {
  constructor(baseUrl = ".") {
    this.baseUrl = baseUrl;
    this.channelsById = {};
    this.usersById = {};
    this.channelDBs = {};
  }

  async fetchUsers() {
    return fetch(`${this.baseUrl}/history/users.json`).then((res) =>
      res.json(),
    );
  }

  async fetchChannels() {
    return fetch(`${this.baseUrl}/history/channels.json`).then((res) =>
      res.json(),
    );
  }

  loadUserData(users) {
    for (const user of users) {
      this.usersById[user.id] = user;
    }
  }
  loadChannelData(channels) {
    for (const channel of channels) {
      this.channelsById[channel.id] = channel;
    }
  }

  async loadChannelDate(channel, year, month, day) {
    const url = `${this.baseUrl}/history/${year}/${month}/${day}/${channel}.json`;
    console.log(url);
    const req = await fetch(url);
    if (req.status === 404) {
      return false;
    }
    const data = await req.json();
    this.channelDBs[channel] ??= new ChannelDB();
    this.channelDBs[channel].loadMessages(data, year, month, day);
    return true;
  }
  *iterMessagesInChannel(channelName) {
    const ch = this.channelDBs[channelName];
    if (ch) {
      yield* ch.iterMessages();
    }
  }
}
