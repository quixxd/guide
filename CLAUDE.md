# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An app that acts as a personal audio tour guide for walks and drives.

`spec.md` holds the agreed product spec: use cases, user scenarios, scope, and roadmap. Treat it as the source of truth for product behaviour, and update it when decisions change.

`architecture.md` compares the backend, data source, and cost options, and records the decisions: start with live generation (A), move to shared fact cards with live narration (B), then add pre-rendered audio caching (C). Standard neural voice at launch. There is no fixed launch region: testing happens wherever we are and in simulated tours, so position must come from a swappable source (real GPS, recorded trace, or simulated route).

`monetization.md` records the launch model: one free tour, then day, week, and annual passes that each include a set number of listening hours, plus top-ups. There are no unlimited plans or ads at launch, prices are regional, and remaining time is not shown on screen.

## Workflow

- Commit and push after each change. One commit per logical change, with a descriptive message. Push to the tracking remote right away.

## Status

The repository is empty: no commits, code, or tooling yet. The tech stack, build/lint/test commands, and architecture are still undecided. Once they are chosen, update this file with:

- Commands to build, lint, run, and test the app, including how to run a single test
- The high-level architecture, especially anything you only understand by reading several files
