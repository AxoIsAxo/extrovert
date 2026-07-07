document.addEventListener('DOMContentLoaded', function() {
  var uploadBtn = document.getElementById('avatarUploadBtn');
  var input = document.getElementById('avatarInput');
  if (uploadBtn && input) {
    uploadBtn.addEventListener('click', function() { input.click(); });
    input.addEventListener('change', function() {
      if (this.files && this.files[0]) this.closest('form').submit();
    });
  }
});
