((magit-commit
  ("--verbose"))
 (magit-dispatch nil)
 (magit-push
  ("--force-with-lease")
  nil)
 (magit-rebase
  ("--autostash")))
