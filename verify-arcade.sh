#!/bin/bash
# Arcade verification scoring (0-8 per page)
set -u

echo "=== Iteration Verification ==="

total=0
passed=0

for f in src/*.html; do
  score=0

  # Theme (2 points)
  grep -q "page-theme.css" "$f" && ((score+=2))

  # Navigation (2 points)
  grep -q 'class="home-link"' "$f" && ((score+=2))

  # Mobile (2 points) - has viewport meta
  grep -q 'name="viewport"' "$f" && ((score+=2))

  # Content (1 point) - >50 lines
  lines=$(wc -l < "$f")
  [ "$lines" -gt 50 ] && ((score+=1))

  # Metadata (1 point)
  slug=$(basename "$f" .html)
  grep -q "\"$slug\"" projectmetadata.json && ((score+=1))

  ((total+=8))
  ((passed+=score))

  [ "$score" -lt 6 ] && echo "LOW: $f ($score/8)"
done

echo "=== Overall Score: $passed / $total ==="
echo "Percentage: $((passed * 100 / total))%"
