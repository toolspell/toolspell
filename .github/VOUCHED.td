# Trust list for this repository, read from the default branch by vouch.yml and pr-limits.yml.
#
# People with write access and bots are trusted automatically; do not list them. Vouched
# contributors are exempt from the open PR limit and the conflict window in CONTRIBUTING.md.
# Denounced ones are banned: whatever they open is closed when it is opened.
#
# Syntax, one entry per line (a malformed line stops the workflows instead of being skipped):
#   github:username
#   -github:username reason for denouncement
#
# Keep entries sorted alphabetically.
