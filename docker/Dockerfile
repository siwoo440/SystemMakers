# PHP 이미지 계열 또는 검증한 digest 선택
ARG PHP_IMAGE=php:8.3-apache-bookworm
# 공식 PHP Apache 런타임
FROM ${PHP_IMAGE}
# GD 빌드 의존성과 필수 PHP 확장 설치
RUN apt-get update && apt-get install -y --no-install-recommends libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev unzip && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp && docker-php-ext-install pdo_mysql gd && rm -rf /var/lib/apt/lists/*
# 공식 Composer 실행 파일
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
# 의존성 설치 기준 위치
WORKDIR /srv/systemmakers/backend/realtime
# 잠금 파일을 먼저 복사
COPY backend/realtime/composer.json backend/realtime/composer.lock ./
# 잠금 버전의 운영 의존성만 설치
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --no-scripts --classmap-authoritative
# 공개 화면과 비공개 실행 코드를 이미지에 복사
COPY . /srv/systemmakers
# 운영 PHP 설정 복사
COPY docker/php.ini /usr/local/etc/php/conf.d/systemmakers.ini
# 단일 공개 진입점과 신뢰 프록시 설정 복사
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf
# 프록시 모듈과 공유 세션 디렉터리 준비
RUN a2enmod remoteip && mkdir -p /var/lib/systemmakers/sessions /var/lib/systemmakers/attachments && chown www-data:www-data /var/lib/systemmakers/sessions /var/lib/systemmakers/attachments && chmod 700 /var/lib/systemmakers/sessions /var/lib/systemmakers/attachments
# 필수 인증 기능과 확장 확인
RUN php /srv/systemmakers/docker/check-runtime.php
# 운영 기본 작업 위치
WORKDIR /srv/systemmakers
# 기본 운영 웹 프로세스
CMD ["apache2-foreground"]
