# Agenda Generation Algorithm

## Inputs

* Active goals
* Pending tasks and subtasks from active goals
* Completion history

---

## Scoring

score =
urgency_weight * urgency +
importance_weight * importance +
recency_weight * recency

---

## Steps

1. Filter active goals
2. Gather pending Tasks and embedded Subtasks, scheduling active Subtasks instead of their parent Task when both are present
3. Score tasks
4. Sort descending
5. Group by context
6. Limit to 3–7 tasks

---

## Output

Ordered list of tasks for today
