//! Focus scoring implementation
//!
//! Mirrors the TypeScript implementation in @goalrate-app/shared/constants/scoring.ts

use chrono::{DateTime, NaiveDate, Utc};

use crate::candidates::{FocusCandidate, Priority};

/// Scoring configuration (from PRD)
#[derive(Debug, Clone)]
pub struct ScoringConfig {
    pub deadline: DeadlineScoring,
    pub blocking: BlockingScoring,
    pub priority: PriorityScoring,
    pub streak: StreakScoring,
    pub sprint: SprintScoring,
}

#[derive(Debug, Clone)]
pub struct DeadlineScoring {
    pub max: u32,
    pub overdue: u32,
    pub today: u32,
    pub week: u32,
    pub month: u32,
    pub later: u32,
}

#[derive(Debug, Clone)]
pub struct BlockingScoring {
    pub max: u32,
    pub people: u32,
    pub multiple: u32,
    pub single: u32,
    pub none: u32,
}

#[derive(Debug, Clone)]
pub struct PriorityScoring {
    pub max: u32,
    pub critical: u32,
    pub high: u32,
    pub medium: u32,
    pub low: u32,
}

#[derive(Debug, Clone)]
pub struct StreakScoring {
    pub max: u32,
    pub at_risk: u32,
    pub active: u32,
    pub none: u32,
}

#[derive(Debug, Clone)]
pub struct SprintScoring {
    pub max: u32,
    pub in_sprint: u32,
    pub not_in_sprint: u32,
}

/// Default scoring configuration from PRD
/// Matches @goalrate-app/shared/constants/scoring.ts
pub static SCORING_CONFIG: ScoringConfig = ScoringConfig {
    deadline: DeadlineScoring {
        max: 30,
        overdue: 30,
        today: 28,
        week: 20,
        month: 10,
        later: 5,
    },
    blocking: BlockingScoring {
        max: 25,
        people: 25,
        multiple: 20,
        single: 15,
        none: 0,
    },
    priority: PriorityScoring {
        max: 20,
        critical: 20,
        high: 15,
        medium: 10,
        low: 5,
    },
    streak: StreakScoring {
        max: 15,
        at_risk: 15,
        active: 10,
        none: 0,
    },
    sprint: SprintScoring {
        max: 10,
        in_sprint: 10,
        not_in_sprint: 0,
    },
};

/// Breakdown of scoring components
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScoringBreakdown {
    pub deadline: u32,
    pub blocking: u32,
    pub priority: u32,
    pub streak: u32,
    pub sprint: u32,
    pub total: u32,
}

impl ScoringBreakdown {
    /// Maximum possible score
    pub const MAX_SCORE: u32 = 100; // 30 + 25 + 20 + 15 + 10
}

/// Score a focus candidate
pub fn score_candidate(candidate: &FocusCandidate, today: NaiveDate) -> ScoringBreakdown {
    let config = &SCORING_CONFIG;

    let deadline = score_deadline(candidate.due_date.as_ref(), today, &config.deadline);
    let blocking = score_blocking(
        candidate.blocks.len(),
        candidate.blocks_people,
        &config.blocking,
    );
    let priority = score_priority(&candidate.priority, &config.priority);
    let streak = score_streak(candidate.last_activity.as_ref(), today, &config.streak);
    let sprint = score_sprint(candidate.in_current_sprint, &config.sprint);

    let total = deadline + blocking + priority + streak + sprint;

    ScoringBreakdown {
        deadline,
        blocking,
        priority,
        streak,
        sprint,
        total,
    }
}

fn score_deadline(due_date: Option<&NaiveDate>, today: NaiveDate, config: &DeadlineScoring) -> u32 {
    match due_date {
        None => config.later,
        Some(due) => {
            let days_until = (*due - today).num_days();

            if days_until < 0 {
                config.overdue
            } else if days_until == 0 {
                config.today
            } else if days_until <= 7 {
                config.week
            } else if days_until <= 30 {
                config.month
            } else {
                config.later
            }
        }
    }
}

fn score_blocking(blocked_count: usize, blocks_people: bool, config: &BlockingScoring) -> u32 {
    if blocks_people {
        config.people
    } else if blocked_count > 1 {
        config.multiple
    } else if blocked_count == 1 {
        config.single
    } else {
        config.none
    }
}

fn score_priority(priority: &Priority, config: &PriorityScoring) -> u32 {
    match priority {
        Priority::Critical => config.critical,
        Priority::High => config.high,
        Priority::Medium => config.medium,
        Priority::Low => config.low,
    }
}

fn score_streak(
    last_activity: Option<&DateTime<Utc>>,
    today: NaiveDate,
    config: &StreakScoring,
) -> u32 {
    match last_activity {
        None => config.none,
        Some(last) => {
            let last_date = last.date_naive();
            let days_since = (today - last_date).num_days();

            if days_since > 7 {
                config.at_risk
            } else if days_since <= 1 {
                config.active
            } else {
                config.none
            }
        }
    }
}

fn score_sprint(in_sprint: bool, config: &SprintScoring) -> u32 {
    if in_sprint {
        config.in_sprint
    } else {
        config.not_in_sprint
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::candidates::FocusItemType;

    fn create_candidate(
        due_date: Option<NaiveDate>,
        priority: Priority,
        in_sprint: bool,
    ) -> FocusCandidate {
        FocusCandidate {
            id: "test_1".into(),
            item_type: FocusItemType::GoalTask,
            title: "Test Task".into(),
            points: 3,
            priority,
            due_date,
            blocks: vec![],
            blocks_people: false,
            in_current_sprint: in_sprint,
            last_activity: None,
            goal_id: None,
            goal_title: None,
            project_id: None,
            project_title: None,
            sprint_id: None,
        }
    }

    #[test]
    fn test_overdue_scores_max_deadline() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let candidate = create_candidate(
            Some(NaiveDate::from_ymd_opt(2024, 1, 10).unwrap()),
            Priority::Medium,
            false,
        );

        let score = score_candidate(&candidate, today);
        assert_eq!(score.deadline, 30); // Overdue
    }

    #[test]
    fn test_due_today_scores_high() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let candidate = create_candidate(Some(today), Priority::Medium, false);

        let score = score_candidate(&candidate, today);
        assert_eq!(score.deadline, 28); // Today
    }

    #[test]
    fn test_due_this_week() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let due = NaiveDate::from_ymd_opt(2024, 1, 20).unwrap(); // 5 days away
        let candidate = create_candidate(Some(due), Priority::Medium, false);

        let score = score_candidate(&candidate, today);
        assert_eq!(score.deadline, 20); // Week
    }

    #[test]
    fn test_high_priority_in_sprint_scores_high() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let candidate = create_candidate(Some(today), Priority::High, true);

        let score = score_candidate(&candidate, today);
        assert_eq!(score.deadline, 28); // Today
        assert_eq!(score.priority, 15); // High
        assert_eq!(score.sprint, 10); // In sprint
        assert!(score.total >= 50);
    }

    #[test]
    fn test_blocking_people_scores_max() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let mut candidate = create_candidate(None, Priority::Medium, false);
        candidate.blocks_people = true;

        let score = score_candidate(&candidate, today);
        assert_eq!(score.blocking, 25); // People
    }

    #[test]
    fn test_blocking_multiple_tasks() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let mut candidate = create_candidate(None, Priority::Medium, false);
        candidate.blocks = vec!["task_2".into(), "task_3".into()];

        let score = score_candidate(&candidate, today);
        assert_eq!(score.blocking, 20); // Multiple
    }

    #[test]
    fn test_critical_priority() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let candidate = create_candidate(None, Priority::Critical, false);

        let score = score_candidate(&candidate, today);
        assert_eq!(score.priority, 20); // Critical
    }

    #[test]
    fn test_no_due_date() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let candidate = create_candidate(None, Priority::Medium, false);

        let score = score_candidate(&candidate, today);
        assert_eq!(score.deadline, 5); // Later
    }
}
