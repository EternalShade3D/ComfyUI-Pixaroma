"""Turn whatever arrived on a "video" wire into frames plus audio.

Save Mp4 Pixaroma encodes an IMAGE batch. ComfyUI also has a second, completely
different thing called a video on the wire - core's VIDEO object - and a node
that only accepts one of the two simply cannot be connected by half its users
(first-last-frame.md #1). This module is the bridge, kept separate from
_video_encode_helpers.py on purpose: that file is the SHARED encoder for Save
Mp4 and Save Video, and this is a new concern that nothing in the encoder needs
to know about. Save Video can import this later at no risk.

WHY get_components() AND NOTHING CLEVERER
-----------------------------------------
First Last Frame prefers lifting two frames off the file with ffmpeg and keeps
get_components() as a fallback, because it only ever wants two frames out of a
long clip. Save Mp4 wants EVERY frame, so there is nothing to save by reading
the file, and get_components() is the correct call rather than a fallback.

That choice also side-steps the two traps first-last-frame.md #2 and #3 spend
most of their length on, and it is worth being explicit that they are avoided
rather than forgotten:

* get_stream_source() is only safe on a VideoFromFile - the base class
  implementation ENCODES the whole clip into a BytesIO just to answer the
  question. We never call it.
* A TRIMMED video (core's Video Slice) is still backed by the untrimmed file,
  so reading that file hands back frames the wire is not carrying. We never
  read the file. get_components() applies the trim itself, so a trimmed video
  is correct here by construction.

THE COST, STATED PLAINLY
------------------------
get_components() decodes the whole clip into memory: MEASURED 7.16 GB peak on a
150-frame 1080x1920 clip against 70 MB through ffmpeg (first-last-frame.md #9),
the peak being roughly double the frame data because core builds a per-frame
list and then stacks it. That is the same cost as core's own Get Video
Components, and Save Mp4 already requires an entire IMAGE batch in memory when
frames are wired, so this does not make the node more expensive than it already
was. It does mean feeding it a very long clip is a memory decision.

Re-encoding is also a quality decision: the frames are decoded and encoded
again, so re-saving an untouched mp4 loses a little. A lossless remux when
nothing on the node would change the picture is a worthwhile future addition
and deliberately NOT attempted here, because it doubles the paths through the
node for a case nobody has asked for yet.
"""

# Channel counts a single frame can legitimately have. Gate on this rather than
# on ndim alone: [H,W,C] (one frame) and [N,H,W] (a MASK batch) are BOTH 3-D,
# and promoting a mask batch builds a valid-LOOKING IMAGE whose "channels" are
# really frames - a 16-frame mask becomes [1,16,64,64] - which passes every
# later check and only dies deep inside the encoder, where nothing in the error
# points back here (first-last-frame.md #12).
_FRAME_CHANNELS = (1, 3, 4)


def as_frame_batch(value):
    """An IMAGE batch [N,H,W,C] from a tensor-ish value, else None.

    Never raises. An optional input is NOT type-guaranteed - any-type
    passthroughs (our own Switch, other packs') bypass ComfyUI's type matching,
    so this slot can receive anything at all
    ([[reference_optional_input_is_not_type_guaranteed]]).
    """
    shape = getattr(value, "shape", None)
    if shape is None or len(shape) not in (3, 4):
        return None
    if int(shape[-1]) not in _FRAME_CHANNELS:
        return None
    if len(shape) == 3:
        try:
            return value[None, ...]
        except Exception:
            return None
    return value


def frame_rate_of(components):
    """The video's own frames-per-second, or None if it will not say.

    This is NOT a nicety. Save Mp4 encodes at whatever `fps` says, and that
    widget exists for the FRAMES path, where a batch of images has no inherent
    rate. A VIDEO does have one, and ignoring it re-times the clip: MEASURED, a
    30fps 3.02s source came back as 3.75s at the widget's default 24, i.e. the
    picture in slow motion while the audio, which is not resampled, stays 3.02s
    long and no longer matches it. Nothing errors; you just get a subtly broken
    video.
    """
    fr = getattr(components, "frame_rate", None)
    if fr is None:
        return None
    try:
        fr = float(fr)          # core hands this over as a Fraction
    except (TypeError, ValueError):
        return None
    # Refuse nonsense rather than encode with it; the caller falls back to the
    # widget. The ceiling matches the fps widget's own max.
    if not (0 < fr <= 120):
        return None
    return fr


def audio_from_components(components):
    """The audio off a VideoComponents, or None.

    None is a completely normal answer: plenty of videos carry no audio track,
    and core hands back None for them.
    """
    audio = getattr(components, "audio", None)
    return audio if audio is not None else None


def frames_and_audio_from_video(video, label="Save Mp4"):
    """(frames, audio, fps) from whatever is on a VIDEO wire. fps may be None.

    Returns an IMAGE batch and either an AUDIO dict or None. Raises ValueError
    with our own wording for something that is neither a video nor usable as
    frames - never an AttributeError naming a method the user has never heard
    of, which is what an unguarded get_components() produces.
    """
    if not hasattr(video, "get_components"):
        # Not a video object. Most usefully this is an IMAGE batch that landed
        # on the wrong slot, which we can simply answer instead of refusing.
        frames = as_frame_batch(video)
        if frames is not None:
            return frames, None, None
        raise ValueError(
            "[Pixaroma] %s - the video input received something that is not a "
            "video (a %s). Wire it to ComfyUI's Load Video, or use the "
            "video_frames input for a batch of frames." % (label, type(video).__name__)
        )

    components = video.get_components()
    frames = as_frame_batch(getattr(components, "images", None))
    if frames is None or int(frames.shape[0]) == 0:
        raise ValueError(
            "[Pixaroma] %s - the wired video decoded to no frames at all. "
            "Check the file plays elsewhere." % label
        )
    return frames, audio_from_components(components), frame_rate_of(components)


def resolve_sources(video_frames, video, label="Save Mp4"):
    """Work out what to encode from the two mutually-exclusive inputs.

    Returns (frames, audio_from_video, fps_from_video, note). `fps_from_video`
    is None whenever the caller should keep its own `fps` widget value. `note`
    is a line worth printing, or "".

    video_frames WINS when both are wired, matching First Last Frame Pixaroma
    (first-last-frame.md #1) so the two nodes cannot disagree about a graph.
    Unlike that node, this one then says so on the console: Save Mp4 encodes a
    whole video, so silently ignoring an input means someone waits out an
    encode of a source they did not pick.
    """
    if video_frames is not None and video is not None:
        return (
            video_frames,
            None,
            None,
            "[Pixaroma] %s - both video_frames and video are wired; using "
            "video_frames and ignoring video." % label,
        )

    if video_frames is not None:
        # The frames path keeps the fps widget: a batch of images has no rate
        # of its own, which is exactly what that widget is for.
        return video_frames, None, None, ""

    if video is not None:
        frames, audio, fps = frames_and_audio_from_video(video, label)
        return frames, audio, fps, ""

    raise ValueError(
        "[Pixaroma] %s - nothing to save. Wire a batch of frames into "
        "video_frames, or a video into video." % label
    )
