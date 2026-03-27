;;----------------------------------------------------------------------------
;; Custom Functions
;;----------------------------------------------------------------------------

(defun move-line-up ()
  "Move current line up."
  (interactive)
  (when (> (line-number-at-pos) 1)
    (let ((col (current-column)))
      (transpose-lines 1)
      (previous-line)
      (previous-line)
      (move-to-column col))))

(defun move-line-down ()
  "Move current line down."
  (interactive)
  (when (< (line-number-at-pos) (count-lines (point-min) (point-max)))
    (let ((col (current-column)))
      (next-line)
      (transpose-lines 1)
      (previous-line)
      (move-to-column col))))

(defun backward-delete-word ()
  "Delete (at most) a word backwards, avoid changing the current line.
If the current line is empty, call `backward-delete-char'."
  (interactive)
  (if (zerop (current-column))
      (call-interactively #'backward-delete-char)
    (let ((point-after-bw (save-excursion (backward-word) (point))))
      (if (< (count-lines 1 point-after-bw) (count-lines 1 (point)))
          (delete-region (line-beginning-position) (point))
        (delete-region (point) point-after-bw)))))

(defun delete-whole-line ()
  "Delete current line."
  (interactive)
  (goto-char (line-beginning-position))
  (delete-region (point) (line-end-position))
  (delete-forward-char 1))

(defun edit-init ()
  "Edit the user Emacs initialization file."
  (interactive)
  (find-file (concat user-emacs-directory "init.el")))

(defun duplicate-line ()
  "Duplicate a line, and move point to it (maintain current column)."
  (interactive)
  (let ((val (buffer-substring (line-beginning-position) (line-end-position))))
    (save-excursion
      (move-end-of-line 1)
      (newline)
      (insert val)))
  (next-line))

(defun dired-org-agenda ()
  "Open `org-directory' with `dired'."
  (interactive)
  (dired org-directory "-l")
  (dired-hide-details-mode))

(defun print-buffer-file-name (&optional arg)
  "Print the current buffer's file path.
If ARG is non-nil, make the file path the latest kill in the kill
ring."
  (interactive "P")
  (let ((name (buffer-file-name)))
    (unless name
      (user-error "Buffer is not visiting any file"))
    (message name)
    (when arg
      (kill-new name))))

(defun wrap-region (c)
  "Wrap point or active region with character C and its corresponding
pair."
  (interactive (list (read-char-exclusive "Wrap region with: ")))
  (let* ((char-pairs '(("{" . "}")
                       ("(" . ")")
                       ("[" . "]")
                       ("<" . ">")
                       ("¿" . "?")
                       ("¡" . "!")))
         (s (char-to-string c))
         (pair (catch 'loop
                 (dolist (p char-pairs)
                   (when (or (string= s (car p))
                             (string= s (cdr p)))
                     (throw 'loop p)))
                 (cons s s))))
    (if (use-region-p)
        (let ((region-end-pos (region-end)))
          (insert-pair nil (car pair) (cdr pair))
          (goto-char (+ region-end-pos 2)))
      (insert (car pair) (cdr pair))
      (backward-char))))

(defun kill-ring-save-whole-buffer ()
  "Save the entire buffer as if killed, but don't kill it."
  (interactive)
  (kill-ring-save (point-min) (point-max))
  (message "Buffer copied to kill ring"))

(defun kill-active-region ()
  "Invoke `kill-region' only if region is active."
  (interactive)
  (when (use-region-p)
    (call-interactively #'kill-region)))

(defun json-pretty-print-dwim ()
  "Prettify JSON in region if it is active, otherwise on whole buffer."
  (interactive)
  (let ((json-encoding-default-indentation (make-string js-indent-level ? )))
    (if (use-region-p)
        (json-pretty-print (region-beginning) (region-end))
      (json-pretty-print-buffer))))

(defun goto-last-edit ()
  "Go to the last edit made in the current buffer."
  (interactive)
  (unless (or (consp buffer-undo-list)
              (not buffer-undo-list))
    (user-error "Can't go to last edit: invalid undo list"))
  (let ((pos (catch 'loop
               (dolist (item buffer-undo-list)
                 (when (and (consp item)
                            (or (integerp (car item))
                                (stringp (car item))))
                   (throw 'loop (abs (cdr item))))))))
    (unless (or (null pos)
                (= (point) pos))
      (push-mark)
      (goto-char pos))))
