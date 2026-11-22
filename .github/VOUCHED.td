# Read from the default branch by vouch.yml and pr-limits.yml. Write access and bots are trusted
# without an entry. Vouched contributors skip the open PR limit and the conflict window; whatever
# denounced ones open is closed. One entry per line, sorted; a malformed line stops the workflows:
#   github:username
#   -github:username reason for denouncement
