;;; variableconfiguration
;;;

;; don't auto-save and back up files
(setq make-backup-files nil)
(setq auto-save-default nil)

(menu-bar-mode -1)
(tool-bar-mode -1)

;; turn on font-lock mode
(when (fboundp 'global-font-lock-mode)
  (global-font-lock-mode t))

;; enable visual feedback on selections
(setq transient-mark-mode t)

(setq-default c-basic-offset 4)
(setq-default c++-basic-offset 4)

;; always replace tabs with spaces
(setq-default indent-tabs-mode nil)

;; set tab width to 4 for all buffers
(setq-default tab-width 4)
(setq indent-line-function 'insert-tab)

;; default to better frame titles
(setq frame-title-format  (concat  "%b - emacs@" system-name))

;; default to unified diffs
(setq diff-switches "-u")

;; set file to auto refresh when change detected (➢ for example: changed by other)
(global-auto-revert-mode 1)

;; reduce the frequency of garbage collection by making it happen on
;; each 50MB of allocated data (the default is on every 0.76MB)
(setq gc-cons-threshold 50000000)

;; warn when opening files bigger than 50MB
(setq large-file-warning-threshold 50000000)

;; Newline at end of file
(setq require-final-newline t)

;; Highlight current line
;;(global-hl-line-mode +1)

;; set custom backup directory  ~ files
(setq backup-directory-alist '(("." . "~/.emacs.d/backups")))

;; no more tool bar
(tool-bar-mode 0)

;; yes or no as y-or-n
(fset 'yes-or-no-p 'y-or-n-p)

;; save desktop mode
(desktop-save-mode 1)

;; Font size
;; ;;;;;;;;;;;;;;;;;;;;
(setq text-scale-mode-step 1.1)
(global-set-key (kbd "C-+") 'text-scale-increase)
(global-set-key (kbd "C--") 'text-scale-decrease)

;; go to previous window
;; ;;;;;;;;;;;;;;;;;;;;
(defun myprevious-window ()
    "go to previous window"
    (interactive)
    (other-window -1))

(global-set-key (kbd "C-x p") 'myprevious-window)

;; save disk space ?
;;(setq delete-old-versions -1)
;;(setq version-control t)
;;(setq vc-make-backup-files t)
;;(setq auto-save-file-name-transforms '((".*" "~/.emacs.d/auto-save-list/" t)))

;; nice save
;; ;;;;;;;;;;;;;;;;;;;;
;; see minor mode whitespace-cleanup instead!!
;;(add-hook 'before-save-hook 'whitespace-cleanup)

; kill lines backward
(global-set-key (kbd "C-<backspace>") (lambda ()
                                        (interactive)
                                        (kill-line 0)
                                        (indent-according-to-mode)))


;; smerge config
(setq smerge-command-prefix (kbd "C-c s"))

;; Dired
(setq dired-listing-switches "-alhv --group-directories-first")
(setq dired-auto-revert-buffer t)


;; gdb
(setq
 ;; use gdb-many-windows by default
 gdb-many-windows t

 ;; Non-nil means display source file containing the main routine at startup
 gdb-show-main t
 )


;; ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; rename a file
;; ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defun rename-current-buffer-file ()
  "Renames current buffer and file it is visiting."
  (interactive)
  (let ((name (buffer-name))
        (filename (buffer-file-name)))
    (if (not (and filename (file-exists-p filename)))
        (error "Buffer '%s' is not visiting a file!" name)
      (let ((new-name (read-file-name "New name: " filename)))
        (if (get-buffer new-name)
            (error "A buffer named '%s' already exists!" new-name)
          (rename-file filename new-name 1)
          (rename-buffer new-name)
          (set-visited-file-name new-name)
          (set-buffer-modified-p nil)
          (message "File '%s' successfully renamed to '%s'"
                   name (file-name-nondirectory new-name)))))))

(global-set-key (kbd "C-x C-r") 'rename-current-buffer-file)
