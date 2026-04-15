fetch-users:
    node scripts/dump-history.js fetch-users

fetch-channels:
    node scripts/dump-history.js fetch-channels

fetch-messages from-date to-date outdir="history" configpath="./fetch-messages-config.json":
    node scripts/dump-history.js fetch-messages {{from-date}} {{to-date}} {{outdir}} {{configpath}}

fetch-newsletter-info from-date to-date: (fetch-users) (fetch-channels) (fetch-messages from-date to-date)

index-replies historydir="history":
    node scripts/index-replies.js {{historydir}}
