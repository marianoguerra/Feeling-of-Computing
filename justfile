fetch-users:
    node scripts/dump-history.js fetch-users

fetch-channels:
    node scripts/dump-history.js fetch-channels

fetch-messages from-date to-date:
    node scripts/dump-history.js fetch-messages {{from-date}} {{to-date}}

fetch-newsletter-info from-date to-date: (fetch-users) (fetch-channels) (fetch-messages from-date to-date)
