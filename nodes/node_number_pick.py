"""Number Pick Pixaroma - a number you pick from buttons you chose yourself.

Thin wrapper. The logic is pure and lives in _number_pick_helpers.py.

Frontend-driven (Vue Compat #9): the buttons, the pick and the output type all
live on node.properties in the browser and are injected into the hidden
NumberPickState input by the graphToPrompt hook in js/number_pick/index.js.
Because that state is part of the node's inputs, changing the number changes the
cache signature, so a run picks up the new value with no IS_CHANGED.

The output is ANY on purpose: the browser narrows the slot to INT or FLOAT to
match whatever it is wired to, so the canvas refuses a wrong drag, and sends the
decision here as `out` so the value arrives as the right Python type.
"""

from ._number_pick_helpers import compute
from ._type_helpers import ANY


class PixaromaNumberPick:
    DESCRIPTION = (
        "One number, picked from a row of buttons you set up yourself. Instead of typing 20 "
        "into a steps box over and over, you put your usual numbers on the node once and click "
        "the one you want.\n\n"
        "Open the settings from the gear on the node to choose the buttons. They are per node, "
        "so one of these can offer 1, 2, 4, 8 for a batch size while another offers 10, 20, 30 "
        "for steps, on the same canvas. Rename the node and it becomes a labelled control for "
        "whatever it drives.\n\n"
        "It sends whole numbers or decimals to suit whatever you plug it into. Wire it to steps "
        "and it sends a whole number; wire it to a frame rate, cfg or denoise and it sends a "
        "decimal. Unplug it and it goes back to fitting anything, so the same node can be moved "
        "around. Before it is wired it decides by the number itself: 4 goes out whole, 4.5 goes "
        "out as a decimal.\n\n"
        "Find it by searching for number, int, integer, value, steps, batch, or picker."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # Hidden, not required: a required STRING would show as a widget AND as
        # a convertible input dot in the Vue frontend (Vue Compat #9). The
        # browser injects the real value at graphToPrompt time.
        return {
            "required": {},
            "hidden": {"NumberPickState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("value",)
    OUTPUT_TOOLTIPS = (
        "The number you picked. It arrives as a whole number or a decimal to match the input it "
        "is wired to, so you can send it straight to steps, a batch size, a width, a frame rate, "
        "cfg or denoise without anything in between.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    def run(self, NumberPickState="{}"):
        return (compute(NumberPickState),)


NODE_CLASS_MAPPINGS = {"PixaromaNumberPick": PixaromaNumberPick}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaNumberPick": "Number Pick Pixaroma"}
