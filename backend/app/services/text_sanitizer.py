"""Remove emoji sequences while preserving ordinary text and text-style symbols."""
import emoji


def remove_emojis(text: str) -> str:
    pieces = []
    cursor = 0
    for token in emoji.analyze(text, join_emoji=True):
        match = token.value
        chars = text[match.start:match.end]
        # Unqualified text-style characters such as ©, ™ and arrows are meaningful
        # symbols unless explicitly selected for emoji presentation.
        if (len(chars) == 1 and emoji.EMOJI_DATA.get(chars, {}).get('status') == 4):
            continue
        pieces.append(text[cursor:match.start])
        cursor = match.end
        # Consume presentation selectors attached to a recognized emoji only.
        while cursor < len(text) and text[cursor] in ('\ufe0e', '\ufe0f'):
            cursor += 1
    pieces.append(text[cursor:])
    return ''.join(pieces)
