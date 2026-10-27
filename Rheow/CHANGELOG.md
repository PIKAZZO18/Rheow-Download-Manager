# Changelog

All notable changes to Rheow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Download throughput no longer collapses to the slowest connection when
  parallel connections have different speeds. Fast connections now claim new
  work instead of idling on a fixed byte range.
- The live speed readout no longer adds a decorative ±0.55% oscillation; it now
  shows the smoothed measured throughput only.
- The active-download card keeps every visual lane moving while chunks are
  scheduled dynamically.

### Changed

- Downloads are split into 1 MiB work-queue chunks (up to 256 per file) served
  by a fixed worker pool capped at the configured connection count.
- The download info modal now labels connections as "parallel streams".

## [1.0.0] - 2026-10-26

### Added

- Initial public release for Windows 10/11 x64.
- Multi-segment HTTP range engine with pre-allocated destination files.
- Single-window dashboard with live segment, speed, and progress views.
- Smart category routing, browser extension bridge, and interactive Windows
  notifications.
- SQLite persistence for downloads, settings, and resume checkpoints.
