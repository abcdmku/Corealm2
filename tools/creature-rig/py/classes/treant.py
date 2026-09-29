"""Treant class: bark and root bipeds (treants, saplings, sporekin, the fae garden guardians) on
the golem skeleton. The fit, the foot blocks, the heel pivot and the rigid bark plates are the
golem class's; this module owns the treants' donor map (treant.donors.json), so their attack is a
studio smash chosen for a tree body instead of the golem's claw or a boxer's punch.
"""
from classes import golem

NAME = "treant"

fit = golem.fit
plan = golem.plan
bind_turns = golem.bind_turns
cloth = golem.cloth
recoil_bones = golem.recoil_bones
