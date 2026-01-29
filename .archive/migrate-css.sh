#!/bin/bash
# Migrate existing HTML files to use shared CSS
# This script extracts article-specific styles and links to wiki-common.css

WIKI_DIR="not-wikipedia"
BACKUP_DIR=".backup-$(date +%Y%m%d-%H%M%S)"

echo "=== CSS Migration Script ==="
echo "This will update HTML files to use wiki-common.css"
echo ""

# Create backup
mkdir -p "$BACKUP_DIR"
cp -r "$WIKI_DIR"/*.html "$BACKUP_DIR/" 2>/dev/null
echo "Backup created in $BACKUP_DIR"
echo ""

for f in "$WIKI_DIR"/*.html; do
  if [[ -f "$f" ]]; then
    filename=$(basename "$f")
    echo "Processing: $filename"

    # Check if already using shared CSS
    if grep -q 'href="wiki-common.css"' "$f"; then
      echo "  Already using shared CSS, skipping"
      continue
    fi

    # Extract the infobox-title background color if present
    infobox_color=$(grep -oE '\.infobox-title\s*\{[^}]*background-color:\s*#[a-fA-F0-9]{6}' "$f" | grep -oE '#[a-fA-F0-9]{6}' | head -1)

    # Extract ambox border-left color if different from default
    ambox_color=$(grep -oE '\.ambox\s*\{[^}]*border-left:[^;]*#[a-fA-F0-9]{6}' "$f" | grep -oE '#[a-fA-F0-9]{6}' | head -1)

    # Create the new head section
    if [[ -n "$infobox_color" || -n "$ambox_color" ]]; then
      style_block="    <style>\n"
      [[ -n "$infobox_color" ]] && style_block+="        .infobox-title { background-color: $infobox_color; }\n"
      [[ -n "$ambox_color" && "$ambox_color" != "#f28500" ]] && style_block+="        .ambox { border-left-color: $ambox_color; }\n"
      style_block+="    </style>"
    else
      style_block=""
    fi

    # Create temp file with new structure
    tmp_file=$(mktemp)

    # Extract everything before <style> and after </style>
    awk '
      /<style>/ { in_style=1; next }
      /<\/style>/ { in_style=0; next }
      !in_style { print }
    ' "$f" > "$tmp_file"

    # Insert the link to shared CSS and article-specific styles
    if [[ -n "$style_block" ]]; then
      sed -i.bak "s|</title>|</title>\n    <link rel=\"stylesheet\" href=\"wiki-common.css\">\n$style_block|" "$tmp_file"
    else
      sed -i.bak 's|</title>|</title>\n    <link rel="stylesheet" href="wiki-common.css">|' "$tmp_file"
    fi

    rm -f "$tmp_file.bak"
    mv "$tmp_file" "$f"

    echo "  Migrated (infobox: ${infobox_color:-default}, ambox: ${ambox_color:-default})"
  fi
done

echo ""
echo "=== Migration Complete ==="
echo "Run 'bash ralph.sh' to validate the ecosystem"
