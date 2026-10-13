# Security

## Reporting something

Report privately, through [GitHub's security
advisories](https://github.com/MaroonedSoftware/bluos/security/advisories/new) on this repository,
and not as a public issue. There is one maintainer, so expect a human rather than an SLA; you will
get an acknowledgement, and a fix or a reason there will not be one.

The latest release is the supported version. There are no backports to older tags.

## What the plugin assumes about where it runs

Worth knowing before you decide whether something is a bug.

**The BluOS API has no authentication.** Anything on the network that can reach a player can
control it, with or without this plugin. The plugin adds no credential because there is none to
add, and it is not a boundary between a player and the rest of the network.

**It talks to the address it is given and to nothing else.** A player is found by mDNS or typed in,
and every request goes to that address over plain HTTP, because that is all a BluOS player serves.
The one exception is cover art, which a player may name by an absolute URL on its streaming
service's own origin; the plugin fetches that URL as the player gave it.

**Discovery answers the local network.** While the settings panel is open, the plugin browses for
players over multicast for five seconds and then stops. It does not keep a socket open.
