/**
 * Responses a BluOS player gives, as fixtures.
 *
 * `SPEC_STATUS` and `SPEC_SYNC_STATUS` are transcribed verbatim from the v1.7 specification's own
 * examples, down to the raw ampersand in the image path, which is worth keeping: the specification
 * prints `&songid=` unescaped, so a real firmware may well send it and a parser has to survive it.
 *
 * The rest are constructed from the field descriptions. They should be REPLACED by captures from a
 * real player as soon as there is one to capture from; `tools/capture.fixtures.mjs` does that.
 */

/** Section 2.1's example: paused, a Deezer track, with a raw `&` in the artwork path. */
export const SPEC_STATUS = `<status etag="4e266c9fbfba6d13d1a4d6ff4bd2e1e6">
<album>÷ (Deluxe)</album>
<artist>Ed Sheeran</artist>
<canMovePlayback>true</canMovePlayback>
<canSeek>1</canSeek>
<cursor>159</cursor>
<fn>Deezer:142986206</fn>
<image>/Artwork?service=Deezer&songid=Deezer%3A142986206</image>
<indexing>0</indexing>
<mid>187</mid>
<mode>1</mode>
<name>Perfect</name>
<pid>1054</pid>
<prid>0</prid>
<quality>320000</quality>
<repeat>2</repeat>
<service>Deezer</service>
<serviceIcon>/Sources/images/DeezerIcon.png</serviceIcon>
<shuffle>0</shuffle>
<sid>8</sid>
<sleep/>
<song>19</song>
<state>pause</state>
<streamFormat>MP3 320 kb/s</streamFormat>
<syncStat>5</syncStat>
<title1>Perfect</title1>
<title2>Ed Sheeran</title2>
<title3>÷ (Deluxe)</title3>
<totlen>263</totlen>
<volume>4</volume>
<secs>35</secs>
</status>`;

/** Section 2.2's example, which carries both a master and slaves; a real player has one or neither. */
export const SPEC_SYNC_STATUS = `<SyncStatus icon="/images/players/P300_nt.png" volume="4" modelName="PULSE" name="PULSE-0278" model="P300" brand="Bluesound" etag="23" outlevel="-62.9" schemaVersion="25" initialized="true" group="PULSE-0278 + 2" syncStat="23" id="192.168.1.100:11000" mac="90:56:82:9F:02:78">
<master port="11000">192.168.1.100</master>
<slave port="11000" id="192.168.1.153"/>
<slave port="11000" id="192.168.1.234"/>
</SyncStatus>`;

/** Playing, and carrying the two-line titles a key is required to prefer. */
export const PLAYING_TWOLINE = `<status etag="aa01">
<album>Ágætis byrjun</album>
<artist>Sigur Rós</artist>
<name>Svefn-g-englar</name>
<title1>Svefn-g-englar</title1>
<title2>Sigur Rós</title2>
<title3>Ágætis byrjun</title3>
<twoline_title1>Svefn-g-englar</twoline_title1>
<twoline_title2>Sigur Rós &#8226; Ágætis byrjun</twoline_title2>
<image>/Artwork?service=LocalMusic&amp;fn=x</image>
<canSeek>1</canSeek>
<state>play</state>
<secs>61</secs>
<totlen>602</totlen>
<volume>37</volume>
<mute>0</mute>
<syncStat>9</syncStat>
</status>`;

/**
 * Internet radio: `streamUrl` is present, so next and previous do not exist, and there is no
 * `totlen`, so a playhead has nothing to draw. This is the ordinary case, not an edge one.
 */
export const RADIO = `<status etag="bb02">
<image>https://img.radioparadise.com/channels/0/42/cover_512x512/0.jpg</image>
<stationImage>/Sources/images/ParadiseRadioIcon.png</stationImage>
<service>TuneIn</service>
<state>stream</state>
<streamFormat>FLAC 850 kb/s</streamFormat>
<streamUrl>http://stream.radioparadise.com/flac</streamUrl>
<secs>1844</secs>
<title1>Radio Paradise</title1>
<title2>Fleetwood Mac</title2>
<title3>The Chain</title3>
<volume>22</volume>
<syncStat>9</syncStat>
</status>`;

/** Muted, with the level to come back to. */
export const MUTED = `<status etag="cc03">
<state>play</state>
<title1>Anything</title1>
<title2>Anybody</title2>
<mute>1</mute>
<volume>0</volume>
<muteVolume>41</muteVolume>
<muteDb>-22.5</muteDb>
<secs>3</secs>
<totlen>200</totlen>
</status>`;

/** A line-out configuration: the specification's "-1 means fixed volume". */
export const FIXED_VOLUME = `<status etag="dd04">
<state>play</state>
<title1>Anything</title1>
<volume>-1</volume>
<secs>3</secs>
<totlen>200</totlen>
</status>`;

/** Stopped, which is the state `/Play` cannot resume from. */
export const STOPPED = `<status etag="ee05">
<state>stop</state>
<syncStat>9</syncStat>
</status>`;

/**
 * Every way BluOS can spell a character that is not ASCII, in one document.
 *
 * A CDATA section holding what looks like a closing tag is the case that breaks a regular
 * expression outright, which is why the parser is a parser.
 */
export const AWKWARD_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment, which is skipped -->
<status etag="ff06">
<title1>Simon &amp; Garfunkel</title1>
<title2><![CDATA[Parsley, Sage </title1> Rosemary & Thyme]]></title2>
<title3>Scarborough Fair &#8212; Canticle &#x2014; caf&#233;</title3>
<name>Don&#39;t Think Twice</name>
<state>play</state>
<volume>50</volume>
</status>`;

/** A player that is on the network but has never been set up in the Controller app. */
export const UNINITIALISED_SYNC = `<SyncStatus name="" brand="NAD" model="C658" modelName="C 658" etag="1" initialized="false" volume="-1" id="192.168.1.77:11000" mac="00:05:5C:13:84:70"/>`;

/** A follower in a group: its /Status is a copy of the leader's, so its own level is only here. */
export const FOLLOWER_SYNC = `<SyncStatus name="Kitchen" brand="Bluesound" model="N125" modelName="NODE" etag="7" initialized="true" volume="18" mute="0" group="Living Room + 1" id="192.168.1.59:11000" mac="DC:B4:D9:31:05:FC">
<master port="11000">192.168.1.58</master>
</SyncStatus>`;
