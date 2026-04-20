fetch-users:
    node scripts/dump-history.js fetch-users

fetch-channels:
    node scripts/dump-history.js fetch-channels

fetch-messages from-date to-date outdir="history" configpath="./fetch-messages-config.json":
    node scripts/dump-history.js fetch-messages {{from-date}} {{to-date}} {{outdir}} {{configpath}}

fetch-newsletter-info from-date to-date: (fetch-users) (fetch-channels) (fetch-messages from-date to-date) (index-replies) (download-attachments "history" "attachments" from-date to-date)
  echo "now run focSyncAttachmentsUp"

index-replies historydir="history":
    node scripts/index-replies.js {{historydir}}

history-to-lancedb from="" to="" historydir="history" dbpath="db_data" tablename="messages" model="Xenova/all-MiniLM-L6-v2":
    node scripts/history-to-lancedb.js {{historydir}} {{dbpath}} {{tablename}} {{model}} {{if from != "" { "--from " + from } else { "" } }} {{if to != "" { "--to " + to } else { "" } }}

query-lancedb query dbpath="db_data" tablename="messages" model="Xenova/all-MiniLM-L6-v2" limit="10":
    node scripts/query-lancedb.js "{{query}}" --db-path {{dbpath}} --table {{tablename}} --model {{model}} --limit {{limit}}

download-attachments historydir="history" outdir="attachments" from="" to="":
    node scripts/download-attachments.js {{historydir}} {{outdir}} {{if from != "" { "--from " + from } else { "" } }} {{if to != "" { "--to " + to } else { "" } }}
