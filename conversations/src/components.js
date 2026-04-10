import { addDays, dateToDateString } from "./date.js";
import { getNameToCode, textFromCode } from "./emoji.js";
import { component, css, html } from "./ui.js";

const NAME_TO_CODE = getNameToCode();
const MSG_PERMALINK_BASE_URL =
  "https://marianoguerra.github.io/Feeling-of-Computing/conversations/";

function formatFileUrl(id, filetype) {
  return `https://history.futureofcoding.org/history/msg_files/${id.slice(0, 3)}/${id}.${filetype}`;
}

export const Messages = component({
  name: "Messages",
  fields: { items: [] },
  methods: {
    mapItems(fn) {
      return this.updateItems((v) => v.map(fn));
    },
    setShowReplies(v) {
      return this.mapItems((m) => m.setShowReplies(v));
    },
    setShowReactions(v) {
      return this.mapItems((m) => m.setShowReactions(v));
    },
    setShowAttachments(v) {
      return this.mapItems((m) => m.setShowAttachments(v));
    },
    setShowChannel(v) {
      return this.mapItems((m) => m.setShowChannel(v));
    },
  },
  view: html`<div class="flex flex-col gap-1 md:gap-3">
    <div @each=".items" class="card card-border bg-base-200 shadow-sm">
      <div
        class="card-body p-0 outline-0 outline-solid outline-base-400 hover:outline-1"
      >
        <x render-it></x>
      </div>
    </div>
  </div>`,
});

export const ConversationsViewer = component({
  name: "ConversationsViewer",
  fields: {
    showReplies: true,
    showReactions: true,
    showAttachments: true,
    showChannel: true,
    activeMessage: null,
    messages: Messages.make(),
  },
  methods: {
    updateActiveMessageIfSet(fn) {
      return this.updateActiveMessage((m) => (m ? fn(m) : null));
    },
    setShowReplies(v) {
      return this.set("showReplies", v)
        .updateMessages((m) => m.setShowReplies(v))
        .updateActiveMessageIfSet((m) => m.setShowReplies(v));
    },
    setShowReactions(v) {
      return this.set("showReactions", v)
        .updateMessages((m) => m.setShowReactions(v))
        .updateActiveMessageIfSet((m) => m.setShowReactions(v));
    },
    setShowAttachments(v) {
      return this.set("showAttachments", v)
        .updateMessages((m) => m.setShowAttachments(v))
        .updateActiveMessageIfSet((m) => m.setShowAttachments(v));
    },
    setShowChannel(v) {
      return this.set("showChannel", v)
        .updateMessages((m) => m.setShowChannel(v))
        .updateActiveMessageIfSet((m) => m.setShowChannel(v));
    },
  },
  globalStyle: css`
    .conversations-grid {
      grid-template-areas:
        "nav"
        "thread"
        "messages";
    }
    .conversations-grid > .area-nav {
      grid-area: nav;
    }
    .conversations-grid > .area-messages {
      grid-area: messages;
      min-width: 0;
    }
    .conversations-grid > .area-thread {
      grid-area: thread;
      min-width: 0;
    }

    @media (min-width: 768px) {
      .conversations-grid:has(.area-thread) {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: auto 1fr;
        grid-template-areas:
          "nav nav"
          "messages thread";
        height: 100vh;
      }
      .conversations-grid:has(.area-thread) > .area-messages,
      .conversations-grid:has(.area-thread) > .area-thread {
        overflow-y: auto;
      }
    }
  `,
  view: html`<section class="conversations-grid grid gap-1 md:gap-3">
    <nav
      class="area-nav flex flex-wrap p-1 md:p-3 gap-1 md:gap-3 justify-evenly bg-base-300 z-2 sticky top-0"
    >
      <label class="label text-xs">
        <input
          type="checkbox"
          :checked=".showReplies"
          @on.input=".setShowReplies value"
          class="toggle toggle-xs"
        />
        Replies
      </label>
      <label class="label text-xs">
        <input
          type="checkbox"
          :checked=".showReactions"
          @on.input=".setShowReactions value"
          class="toggle toggle-xs"
        />
        Reactions
      </label>
      <label class="label text-xs">
        <input
          type="checkbox"
          :checked=".showAttachments"
          @on.input=".setShowAttachments value"
          class="toggle toggle-xs"
        />
        Attachments
      </label>
      <label class="label text-xs">
        <input
          type="checkbox"
          :checked=".showChannel"
          @on.input=".setShowChannel value"
          class="toggle toggle-xs"
        />
        Channels
      </label>
    </nav>
    <div class="area-messages">
      <x render=".messages"></x>
    </div>
    <div
      class="area-thread flex flex-col gap-1 md:gap-3"
      @show=".isActiveMessageSet"
    >
      <div
        class="flex bg-base-300 justify-between items-center gap-1 md:gap-3 p-2 sticky top-0 z-1"
      >
        <span class="font-bold text-lg">Thread</span>
        <button
          class="btn btn-sm btn-ghost btn-error font-mono"
          @on.click=".resetActiveMessage"
        >
          X
        </button>
      </div>

      <div class="card card-border bg-base-200 shadow-sm">
        <div
          class="card-body p-0 outline-0 outline-solid outline-base-400 hover:outline-1"
        >
          <x render=".activeMessage"></x>
        </div>
      </div>
    </div>
  </section>`,
});

const pr = new Intl.PluralRules("en");

function pluralize(count, singular, plural) {
  return `${count} ${pr.select(count) === "one" ? singular : plural}`;
}

export const Message = component({
  name: "Message",
  fields: {
    author: null,
    channel: null,
    date: new Date(),
    body: null,
    reactions: [],
    replies: [],
    attachments: [],
    files: [],
    showReplies: true,
    showReactions: true,
    showAttachments: true,
    showChannel: true,
  },
  statics: {
    fromData(d, ctx) {
      const { usersById, channelsById } = ctx;
      const {
        ts,
        user: userId,
        blocks,
        thread_replies: rawReplies = [],
        reactions: rawReactions = [],
        attachments: rawAttachments = [],
        files: rawFiles = [],
      } = d;
      const date = new Date(+ts * 1000);
      const author =
        usersById[userId] ?? User.make({ id: userId, name: userId, realName: `@${userId}` });
      const channel = channelsById[d.channel_id] ?? null;
      const body = Blocks.Class.fromData(blocks, ctx);
      const replies = new Array(Math.max(0, rawReplies.length - 1));
      if (rawReplies.length > 0) {
        for (let i = 1; i < rawReplies.length; i++) {
          const reply = rawReplies[i];
          replies[i - 1] = this.fromData(reply, ctx).setShowChannel(false);
        }
      }
      // TODO: optimize
      const reactions = [];
      for (const reaction of rawReactions) {
        reactions.push(Reaction.Class.fromData(reaction));
      }
      // TODO: optimize
      const attachments = [];
      for (const attachment of rawAttachments) {
        attachments.push(Attachment.Class.fromData(attachment, ctx));
      }
      // TODO: optimize
      const files = [];
      for (const file of rawFiles) {
        files.push(File.Class.fromData(file, ctx));
      }
      return this.make({
        author,
        channel,
        date,
        body,
        reactions,
        replies,
        attachments,
        files,
      });
    },
  },
  methods: {
    formatDisplayDate() {
      return this.date.toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
    },
    formatDateTime() {
      return this.date.toISOString();
    },
    formatMessageAnchor() {
      return `#${this.date.toISOString()}`;
    },
    formatMessagePermalink() {
      const from = dateToDateString(addDays(this.date, -1));
      const to = dateToDateString(addDays(this.date, 1));
      return `${MSG_PERMALINK_BASE_URL}?from-date=${from}&to-date=${to}#${this.date.toISOString()}`;
    },
    areAttachmentsVisible() {
      return this.showAttachments && !this.attachmentsIsEmpty();
    },
    areFilesVisible() {
      return this.showAttachments && !this.filesIsEmpty();
    },
    areReactionsVisible() {
      return this.showReactions && !this.reactionsIsEmpty();
    },
    areRepliesVisible() {
      return this.showReplies && !this.repliesIsEmpty();
    },
    mapReplies(fn) {
      return this.updateReplies((v) => v.map(fn));
    },
    setShowReplies(v) {
      return this.set("showReplies", v).mapReplies((m) => m.setShowReplies(v));
    },
    setShowReactions(v) {
      return this.set("showReactions", v).mapReplies((m) => m.setShowReactions(v));
    },
    setShowAttachments(v) {
      return this.set("showAttachments", v).mapReplies((m) => m.setShowAttachments(v));
    },
    isChannelVisible() {
      return this.showChannel && this.channel !== null;
    },
    repliesCountLabel() {
      return pluralize(this.replies.size, "Reply", "Replies");
    },
    reactionsCountLabel() {
      return pluralize(this.reactions.size, "Reaction", "Reactions");
    },
    filesCountLabel() {
      return pluralize(this.files.size, "File", "Files");
    },
  },
  view: html`<section class="flex flex-col gap-1 md:gap-3">
    <div class="hover:bg-base-300 p-3 flex flex-col gap-1 md:gap-3">
      <div class="flex flex-wrap gap-1 md:gap-3 items-center">
        <x render=".author" as="handle"></x>
        <div @show=".isChannelVisible">
          <x render=".channel" as="handle"></x>
        </div>
        <a
          class="text-content-200 text-xs"
          :href=".formatMessageAnchor"
          @text=".formatDisplayDate"
        ></a>
      </div>
      <x render=".body"></x>
      <div class="flex flex-col gap-1 md:gap-3" @show=".areAttachmentsVisible">
        <x render-each=".attachments"></x>
      </div>
      <div class="flex flex-col gap-1 md:gap-3" @show=".areFilesVisible">
        <x render-each=".files"></x>
      </div>
      <div class="flex gap-1 md:gap-3" @show=".areReactionsVisible">
        <x render-each=".reactions"></x>
      </div>
    </div>
    <div
      class="flex flex-col m-3 pl-3 border-l border-l-gray-500"
      @show=".areRepliesVisible"
    >
      <x render-each=".replies"></x>
    </div>
  </section>`,
});

export const User = component({
  name: "User",
  fields: { id: "?", name: "?", realName: "" },
  statics: {
    fromData(d, ctx) {
      const { user_id: id } = d ?? {};
      return ctx.usersById[id] ?? this.make({ id, name: id, realName: `@${id}` });
    },
  },
  view: html`<span class="font-bold" :title=".name" @text=".realName"></span>`,
  views: {
    handle: html`<span
      class="badge badge-primary before:content-['@']"
      @text=".realName"
    ></span>`,
  },
});

export const Channel = component({
  name: "Channel",
  fields: { id: "?", name: "?" },
  statics: {
    fromData(d, ctx) {
      const { channel_id: id } = d ?? {};
      return ctx.channelsById[id] ?? this.make({ id, name: `#${id}` });
    },
  },
  view: html`<span class="font-bold" @text=".name"></span>`,
  views: {
    handle: html`<span
      class="badge badge-outline badge-primary before:content-['#']"
      @text=".name"
    ></span>`,
  },
});

export const Emoji = component({
  name: "Emoji",
  fields: { name: "", unicode: "", text: "?" },
  statics: {
    fromData(d) {
      const { name, unicode } = d ?? {};
      const text = textFromCode(unicode);
      return this.make({ name, unicode, text });
    },
  },
  view: html`<span @text=".text"></span>`,
});

export const Reaction = component({
  name: "Reaction",
  fields: { icon: "?", count: 1 },
  statics: {
    fromData(d) {
      const { name, count } = d ?? {};
      const code = NAME_TO_CODE[name];
      const icon = code ? textFromCode(code) : `:${name}:`;
      return this.make({ icon, count });
    },
  },
  view: html`<div class="badge badge-soft badge-info gap-2">
    <span @text=".icon"></span><span @text=".count"></span>
  </div>`,
});

export const Thumbnail = component({
  name: "Thumbnail",
  fields: { url: "", width: 100, height: 100 },
  view: html`<img :src=".url" :width=".width" :height=".height" />`,
});

export const Attachment = component({
  name: "Attachment",
  fields: {
    icon: "🔗",
    text: "?",
    url: "#",
    sourceName: "?",
    sourceUrl: "#",
    thumbnail: null,
  },
  statics: {
    fromData(d, ctx) {
      const {
        service_name,
        thumb_url,
        thumb_width,
        thumb_height,
        title,
        title_link,
        text: dtext,
        author_name,
        author_link,
        fallback,
        original_url,
        message_blocks,
      } = d ?? {};

      if (Array.isArray(message_blocks)) {
        const items = [];
        for (const item of message_blocks) {
          items.push(Blocks.Class.fromData(item.message.blocks, ctx));
        }
        // TODO: attachment subtype and better
        return RichTextQuote.make({ elements: items }, ctx);
      }
      const thumbnail = thumb_url
        ? Thumbnail.make({
            url: thumb_url,
            width: thumb_width,
            height: thumb_height,
          })
        : null;
      let sourceName = "";
      let sourceUrl = "#";
      if (author_name) {
        sourceName = author_name;
        sourceUrl = author_link;
      } else if (title_link) {
        sourceName = title;
        sourceUrl = title_link;
      } else {
        console.log("unknown attachment source", d);
      }
      const text = title ?? dtext ?? fallback;
      const url = title_link ?? original_url;
      return this.make({
        text,
        url,
        icon: this.serviceNameToIcon(service_name),
        sourceName,
        sourceUrl,
        thumbnail,
      });
    },
    serviceNameToIcon(v) {
      switch (v) {
        case "YouTube":
          return "🎥";
        case "twitter":
        case "Twitter":
        case "X (formerly Twitter)":
          return "🐦";
        case "bluesky":
          return "🦋";
        case "arXiv.org":
          return "📄";
        case "Medium":
          return "📝";
        default:
          return "🔗";
      }
    },
  },
  view: html`<div
    class="flex flex-col gap-1 md:gap-3 border-l-4 border-gray-500 pl-3 mb-2"
  >
    <div class="flex gap-1 md:gap-3 align-baseline">
      <span @text=".icon"></span>
      <a
        class="cursor-pointer font-bold"
        :href=".sourceUrl"
        @text=".sourceName"
      ></a>
    </div>
    <a class="cursor-pointer text-sky-500" :href=".url" @text=".text"></a>
    <x render=".thumbnail"></x>
  </div>`,
});

export const Image = component({
  name: "Image",
  fields: { id: "", filetype: "", text: "" },
  methods: {
    formatUrl() {
      const { id, filetype } = this;
      return formatFileUrl(id, filetype);
    },
  },
  view: html`<a :href=".formatUrl" target="_blank"
    ><img
      :src=".formatUrl"
      :alt=".text"
      style="max-height: 40vh; width: auto; cursor: pointer"
  /></a>`,
});

export const Video = component({
  name: "Video",
  fields: { id: "", filetype: "", text: "" },
  methods: {
    formatUrl() {
      const { id, filetype } = this;
      return formatFileUrl(id, filetype);
    },
  },
  view: html`<video
    controls
    preload="metadata"
    :src=".formatUrl"
    :alt=".text"
    style="max-height: 40vh; width: auto; cursor: pointer"
  />`,
});

export const File = component({
  name: "File",
  fields: { icon: "🔗", text: "?", url: "#" },
  statics: {
    fromData(d, _ctx) {
      if (d?.mode === "tombstone") {
        return this.make({ text: "🪦" });
      }
      const {
        title,
        name,
        mimetype,
        //permalink,
        //permalink_public,
        id,
        filetype,
      } = d ?? {};

      const text = title ?? name;
      if (mimetype.startsWith("image/")) {
        return Image.make({ id, filetype, text });
      } else if (mimetype.startsWith("video/")) {
        return Video.make({ id, filetype, text });
      }
      //const url = permalink_public ?? permalink;
      const url = formatFileUrl(id, filetype);
      const icon = this.mimetypeToIcon(mimetype);
      return this.make({ text, url, icon });
    },
    mimetypeToIcon(mimetype) {
      if (mimetype.startsWith("video/")) {
        return "🎥";
      } else if (mimetype.startsWith("image/")) {
        return "🖼️";
      } else if (mimetype.startsWith("application/")) {
        return "📄";
      } else if (mimetype.startsWith("text/")) {
        return "🗒️";
      } else {
        return "📝";
      }
    },
  },
  view: html`<div class="flex gap-1 md:gap-3 align-baseline">
    <span @text=".icon"></span>
    <a class="cursor-pointer underline" :href=".url" @text=".text"></a>
  </div>`,
});

export const Blocks = component({
  name: "Blocks",
  fields: { items: [] },
  statics: {
    fromData(d = [], ctx) {
      const r = [];
      for (const block of d ?? []) {
        switch (block.type) {
          case "rich_text":
            r.push(RichText.Class.fromData(block, ctx));
            break;
          default:
            console.warn("unknown block type", block.type);
        }
      }
      return this.make({ items: r });
    },
  },
  view: html`<div class="flex flex-col gap-1 md:gap-3">
    <x render-each=".items"></x>
  </div>`,
});

function parseRichTextElements(elements, ctx) {
  const r = [];
  for (const item of elements) {
    switch (item.type) {
      case "rich_text_section":
        r.push(RichTextSection.Class.fromData(item, ctx));
        break;
      case "rich_text_quote":
        r.push(RichTextQuote.Class.fromData(item, ctx));
        break;
      case "rich_text_preformatted":
        r.push(RichTextPreformatted.Class.fromData(item, ctx));
        break;
      case "rich_text_list":
        r.push(RichTextList.Class.fromData(item, ctx));
        break;
      default:
        console.warn("unknown rich text element type", item.type, item);
    }
  }
  return r;
}

export const RichText = component({
  name: "RichText",
  fields: { elements: [] },
  statics: {
    fromData(d, ctx) {
      return this.make({
        elements: parseRichTextElements(d?.elements ?? [], ctx),
      });
    },
  },
  view: html`<div><x render-each=".elements"></x></div>`,
});

function parseRichTextSectionElements(elements = [], ctx) {
  const r = [];
  for (const item of elements) {
    switch (item.type) {
      case "text": {
        const lines = item.text.split("\n");
        if (lines.length === 1) {
          r.push(Text.Class.fromData(item));
        } else {
          for (let i = 0; i < lines.length; i++) {
            const text = lines[i];
            if (i > 0) {
              r.push(NEW_LINE);
            }
            r.push(Text.Class.fromData({ ...item, text }));
          }
        }
        break;
      }
      case "link":
        r.push(Link.Class.fromData(item));
        break;
      case "user":
        r.push(User.Class.fromData(item, ctx));
        break;
      case "channel":
        r.push(Channel.Class.fromData(item, ctx));
        break;
      case "emoji":
        r.push(Emoji.Class.fromData(item));
        break;
      default:
        console.warn("unknown rich text section type", item.type, item);
    }
  }
  return r;
}

export const RichTextSection = component({
  name: "RichTextSection",
  fields: { elements: [] },
  statics: {
    fromData(d, ctx) {
      return this.make({
        elements: parseRichTextSectionElements(d?.elements, ctx),
      });
    },
  },
  view: html`<x render-each=".elements"></x>`,
});

export const RichTextQuote = component({
  name: "RichTextQuote",
  fields: { elements: [] },
  statics: {
    fromData(d, ctx) {
      return this.make({
        elements: parseRichTextSectionElements(d?.elements, ctx),
      });
    },
  },
  view: html`<div class="border-l-4 border-gray-500 pl-3 mb-2">
    <x render-each=".elements"></x>
  </div>`,
});

export const RichTextPreformatted = component({
  name: "RichTextPreformatted",
  fields: { elements: [] },
  statics: {
    fromData(d) {
      return this.make({ elements: parseRichTextSectionElements(d?.elements) });
    },
  },
  view: html`<div class="border-1 border-gray-500 p-3 my-3 font-mono text-sm">
    <x render-each=".elements"></x>
  </div>`,
});

export const RichTextList = component({
  name: "RichTextList",
  fields: { style: "bullet", elements: [] },
  methods: {
    isBullet() {
      return this.style === "bullet";
    },
  },
  computed: {
    className() {
      return this.isBullet() ? "list-disc ml-5" : "list-decimal ml-5";
    },
  },
  statics: {
    fromData(d, ctx) {
      return this.make({
        style: d.style ?? "bullet",
        elements: parseRichTextElements(d?.elements, ctx),
      });
    },
  },
  view: html`<ul :class="$className">
    <li @each=".elements"><x render-it></x></li>
  </ul>`,
});

export const Link = component({
  name: "Link",
  fields: { url: "?", text: "" },
  statics: {
    fromData(d) {
      const { url, text = url } = d ?? {};
      return this.make({ url, text });
    },
  },
  view: html`<a
    class="cursor-pointer underline text-sky-500"
    :href=".url"
    @text=".text"
  ></a>`,
});

export const NewLine = component({
  name: "NewLine",
  view: html`<br />`,
});

const NEW_LINE = NewLine.make();

export const Text = component({
  name: "Text",
  fields: {
    text: "",
    bold: false,
    italic: false,
    strike: false,
    code: false,
  },
  computed: {
    className() {
      const { bold, italic, strike, code } = this;
      let className = "";
      if (bold || italic || strike || code) {
        const parts = [];
        if (bold) {
          parts.push("font-bold");
        }
        if (italic) {
          parts.push("italic");
        }
        if (strike) {
          parts.push("line-through");
        }
        if (code) {
          parts.push("badge badge-soft font-mono p-1");
        }
        className = parts.join(" ");
      }
      return className;
    },
    inlineStyle() {
      const { bold, italic, strike, code } = this;
      let inlineStyle = "white-space: pre-wrap";
      if (bold || italic || strike || code) {
        const parts = [];
        if (bold) {
          parts.push("font-weight: bold");
        }
        if (italic) {
          parts.push("font-style: italic");
        }
        if (strike) {
          parts.push("text-decoration-line: line-through");
        }
        if (code) {
          parts.push(
            'font-family:  ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          );
        }
        inlineStyle = parts.join(";");
      }
      return inlineStyle;
    },
  },
  statics: {
    fromData(d) {
      const { text, style = {} } = d ?? {};
      const { bold, italic, strike, code } = style;
      return this.make({ text, bold, italic, strike, code });
    },
  },
  view: html`<span
    :class="whitespace-pre-wrap {$className}"
    @text=".text"
  ></span>`,
});

export function getComponents() {
  return [
    ConversationsViewer,
    Message,
    Messages,
    User,
    Channel,
    Attachment,
    File,
    Reaction,
    Blocks,
    RichText,
    RichTextSection,
    RichTextQuote,
    RichTextPreformatted,
    RichTextList,
    Link,
    Text,
    NewLine,
    Emoji,
    Thumbnail,
    Image,
    Video,
  ];
}
