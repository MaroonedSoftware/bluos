/**
 * Responses a BluOS player gives, as fixtures.
 *
 * `SPEC_STATUS` and `SPEC_SYNC_STATUS` are transcribed verbatim from the v1.7 specification's own
 * examples, down to the raw ampersand in the image path, which is worth keeping: the specification
 * prints `&songid=` unescaped, so a real firmware may well send it and a parser has to survive it.
 *
 * `REAL_STREAM_STATUS` and `REAL_SYNC_STATUS` at the bottom came off an actual player.
 *
 * The rest are constructed from the field descriptions, and cover shapes the one player to hand
 * does not currently produce: a queue-backed track with a length, a muted player, a fixed output,
 * and a group. Capture those too when there is a player doing them; `tools/capture.mjs --write`
 * saves what it reads.
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

/**
 * Streaming radio that CAN skip: section 4.8's own example, a player on Slacker.
 *
 * The `<actions>` block is transcribed verbatim, including the raw ampersands in the URLs. Back
 * carries no `url`, which is the player saying back is not available on this station.
 */
export const SLACKER_STATUS = `<status etag="gg07">
<state>stream</state>
<service>Slacker</service>
<streamUrl>Slacker:station/12345</streamUrl>
<title1>Slacker Radio</title1>
<title2>Some Artist</title2>
<volume>30</volume>
<actions>
<action name="back"/>
<action name="skip" url="/Action?service=Slacker&skip=4799148"/>
<action icon="/images/loveban/love.png" name="love" notification="Track marked as favorite" state="-1" text="Love" url="/Action?service=Slacker&love=4799148"/>
<action icon="/images/loveban/ban.png" name="ban" notification="Track banned from this station" state="-1" text="Ban" url="/Action?service=Slacker&ban=4799148"/>
</actions>
</status>`;

/**
 * Section 6.1's example: two presets, one a Radio Paradise station with an absolute image and one a
 * Tidal playlist whose image is an `/Artwork` path on the player. The PDF wraps the long attributes
 * across lines; they are rejoined here, and the entities kept exactly as printed.
 */
export const SPEC_PRESETS = `<presets prid="2">
<preset id="6" name="Serenity" url="RadioParadise:/42:4/Serenity" image="https://img.radioparadise.com/channels/0/42/cover_512x512/0.jpg"/>
<preset id="7" name="1980s Alternative Rock Classics" url="/Load?service=Tidal&amp;id=fd3f797e-a3e9-4de9-a1e2-b5adb6a57cc7" image="/Artwork?service=Tidal&amp;playlistimage=afacfc12-2403-4caf-a5c5-a2af28d811c8"/>
</presets>`;

/**
 * Section 11.1's example: a player's own inputs, a cloud service, and a HUB's inputs in a category.
 *
 * The PDF wraps long attributes across lines; the URLs are rejoined here, because a line break in the
 * middle of one is the PDF's, not the player's. The names are left wrapped where the PDF wrapped
 * them, because a real player could send whitespace there too and the reading has to cope.
 */
export const SPEC_INPUTS = `<radiotime service="Capture">
<item playerName="Tick Tick" text="Bluetooth" inputType="bluetooth" id="input2" URL="Capture%3Abluez%3Abluetooth" image="/images/BluetoothIcon.png" type="audio"/>
<item playerName="Tick Tick" text="Analog
Input" inputType="analog" id="input0" URL="Capture%3Aplughw%3Aimxnadadc%2C0%2F48000%2F24%2F2%3Fid%3Dinput0" image="/images/capture/ic_analoginput.png" type="audio"/>
<item playerName="Tick Tick" text="Optical
Input" inputType="spdif" id="input1" URL="Capture%3Ahw%3Aimxspdif%2C0%2F1%2F25%2F2%3Fid%3Dinput1" image="/images/capture/ic_opticalinput.png" type="audio"/>
<item playerName="Tick Tick" text="Spotify" id="Spotify" URL="Spotify%3Aplay" image="/Sources/images/SpotifyIcon.png" serviceType="CloudService" type="audio"/>
<category icon="/images/CB130Icon.png" text="Test Hub">
<remoteitem playerName="Test Hub" text="Analog Input" inputType="analog" id="hub-192168114911000-input0" URL="Hub%3A%2F%2F192.168.1.149%3A11000%2Finput0" image="/images/capture/ic_analoginput.png" type="audio"/>
<remoteitem playerName="Test Hub" text="HDMI ARC" inputType="arc" id="hub-192168114911000-input4" URL="Hub%3A%2F%2F192.168.1.149%3A11000%2Finput4" image="/images/capture/ic_tv.png" type="audio"/>
</category>
</radiotime>`;

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

/**
 * CAPTURED FROM A REAL PLAYER: an NAD M10 V2 named "Office", BluOS 4.16.22, on 2026-09-17, playing
 * an internet radio stream. Byte for byte as the player sent it, which is the point of it.
 *
 * It exercises several things the constructed fixtures above do not, and each one is a small
 * surprise worth keeping:
 *
 * - The whole document is on one line with an XML declaration in front of it.
 * - `<sleep></sleep>` is an empty PAIR, not the self-closing `<sleep/>` the specification prints.
 * - It carries fields the specification does not document at all (`currentImage`, `serviceName`,
 *   `serviceType`), which is exactly the case the specification tells clients to ignore.
 * - There is no `title3` and no `totlen`, and `canSeek` is 0.
 * - `twoline_title1` IS present, so the two-line titles are the ordinary path rather than a
 *   fallback, and following the specification instead of copying pyblu was not academic.
 * - `secs` is 9696, which is time on the stream rather than a position in a track. With no
 *   `totlen` beside it, a playhead that guessed would draw a meaningless bar.
 */
export const REAL_STREAM_STATUS = `<?xml version="1.0" encoding="UTF-8"?>
<status etag="c0a12c986682919f1ac2413e2972bb3c"><canMovePlayback>true</canMovePlayback><canSeek>0</canSeek><currentImage>https://radio.deanhome.app/api/art/ef20a0c0-3957-486c-92d3-7a4f56fe8dad/cover.jpg</currentImage><cursor>0</cursor><db>-56.7</db><image>https://radio.deanhome.app/api/art/ef20a0c0-3957-486c-92d3-7a4f56fe8dad/cover.jpg</image><indexing>0</indexing><mid>0</mid><mode>1</mode><mute>0</mute><pid>2</pid><prid>0</prid><quality>0</quality><repeat>0</repeat><secs>9696</secs><service>TuneIn</service><serviceIcon>/Sources/images/TuneInIcon.png</serviceIcon><serviceName>TuneIn</serviceName><serviceType>RadioService</serviceType><shuffle>0</shuffle><sid>5</sid><sleep></sleep><song>0</song><state>stream</state><streamFormat>MP3</streamFormat><streamUrl>TuneIn:https://radio.deanhome.app/live.mp3</streamUrl><syncStat>203</syncStat><title1>Deadair</title1><title2>Led Zeppelin - When the Levee Breaks - Remaster</title2><twoline_title1>Deadair</twoline_title1><twoline_title2>Led Zeppelin - When the Levee Breaks - Remaster</twoline_title2><volume>19</volume></status>`;

/**
 * The same player's `/SyncStatus`, captured at the same moment.
 *
 * Note `syncStat="203"` here and `<syncStat>203</syncStat>` in the status above: the linkage the
 * specification describes, which is what lets one long-poll cover both resources, holds in practice.
 *
 * It also carries nested children (`<zoneOptions>` with `<option>` inside, `<bluetoothOutput>`)
 * where the specification's example has only `<master>` and `<slave>`, and attributes found nowhere
 * in the specification (`class`, `hasSubwoofer`, `version`). An ungrouped player has no `group`
 * attribute and no `mute` attribute at all.
 */
export const REAL_SYNC_STATUS = `<?xml version="1.0" encoding="UTF-8"?>
<SyncStatus etag="203" syncStat="203" version="4.16.22" id="192.168.1.234:11000" db="-56.7" volume="19" name="Office" model="M10v2" modelName="M10 V2" class="streamer-amplifier" icon="/images/players/M10_sub.png" brand="NAD" schemaVersion="34" initialized="true" mac="90:56:82:00:BC:99" hasSubwoofer="true"><zoneOptions><option canHaveCentre="true" zoneMaster="true">front</option><option zoneMaster="true">side</option></zoneOptions><bluetoothOutput></bluetoothOutput></SyncStatus>`;
